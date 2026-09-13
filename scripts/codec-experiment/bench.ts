import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { cpus, platform, arch } from 'node:os'

const [input, output, startArg = '0', secondsArg = '25'] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: bun scripts/codec-experiment/bench.ts <real recording> <output directory> [start] [seconds]')
const start = Number(startArg), seconds = Number(secondsArg), dir = resolve(output)
if (!Number.isFinite(start) || start < 0 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new Error('Choose a valid interval up to 10 minutes.')
await mkdir(dir, { recursive: true })
async function run(command: string, args: string[]): Promise<number> {
  const began = performance.now()
  await new Promise<void>((ok, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let error = ''
    child.stderr.on('data', value => { error = (error + value).slice(-2000) })
    child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(new Error(`${command}: ${error}`)))
  })
  return performance.now() - began
}
const pcm = join(dir, 'source.pcm')
const sourceDecodeMs = await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-i', resolve(input), '-t', String(seconds), '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', pcm])
const duration = (await stat(pcm)).size / 96000
await run('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', pcm, join(dir, 'reference.wav')])
const candidates: Record<string, unknown>[] = []
for (const kbps of [24, 16]) {
  const name = `opus-${kbps}`, file = `${name}.webm`, decoded = `${name}.wav`
  const encodeMs = await run('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', pcm, '-c:a', 'libopus', '-application', 'voip', '-frame_duration', '20', '-b:a', `${kbps}k`, join(dir, file)])
  const decodeMs = await run('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, file), join(dir, decoded)])
  candidates.push({ name, file, decoded, kbps, bytes: (await stat(join(dir, file))).size, encodeMs, decodeMs, encodeRealtime: duration * 1000 / encodeMs, browser: 'native Opus; measure startup and seek separately' })
}
const build = process.env.SPEECHEDIT_OPUS_BUILD
if (build) {
  const config = await readFile(join(build, 'config.h'), 'utf8')
  if (!/^#define ENABLE_OSCE 1$/m.test(config) || !/^#define PACKAGE_VERSION "1\.5\.2"$/m.test(config)) throw new Error('Use the pinned Opus 1.5.2 build with --enable-osce; ordinary Opus is not NoLACE.')
  for (const kbps of [12, 9]) {
    const name = `nolace-${kbps}`, file = `${name}.packets`, decoded = `${name}.wav`, raw = join(dir, `${name}.pcm`)
    const encodeMs = await run(join(resolve(build), 'opus_demo'), ['-e', 'voip', '48000', '1', String(kbps * 1000), '-bandwidth', 'WB', '-framesize', '20', pcm, join(dir, file)])
    const decodeMs = await run(join(resolve(build), 'opus_demo'), ['-d', '48000', '1', '-dec_complexity', '7', join(dir, file), raw])
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', raw, join(dir, decoded)])
    const packets = await readFile(join(dir, file)); let payloadBytes = 0, count = 0
    for (let offset = 0; offset < packets.length;) { const length = packets.readUInt32BE(offset); if (offset + 8 + length > packets.length) throw new Error('Invalid Opus packet stream.'); payloadBytes += length; count++; offset += 8 + length }
    candidates.push({ name, file, decoded, kbps, bytes: packets.length, payloadBytes, packets: count, encodeMs, decodeMs, encodeRealtime: duration * 1000 / encodeMs, opusVersion: '1.5.2', decoderComplexity: 7, browser: 'NOT READY: requires a NoLACE-enabled browser/WASM decoder; WAV is only a listening copy' })
  }
}
const result = { source: { name: input.split('/').at(-1), start, duration, decodeMs: sourceDecodeMs }, cpu: cpus()[0]?.model, platform: `${platform()} ${arch()}`, createdAt: new Date().toISOString(), candidates, nolace: build ? 'native CPU only; not promoted' : 'not run: set SPEECHEDIT_OPUS_BUILD', lyra: 'follow-up, not promoted', browserResults: null, review: { names: null, numbers: null, overlappingSpeech: null, notes: 'Listen blind and record exact errors. No codec is promoted automatically.' } }
await writeFile(join(dir, 'results.json'), JSON.stringify(result, null, 2))
const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)
await writeFile(join(dir, 'listen.html'), `<!doctype html><meta charset="utf-8"><title>SpeechEdit codec experiment</title><style>body{font:17px system-ui;max-width:850px;margin:40px auto;padding:20px}article{padding:20px 0;border-bottom:1px solid #bbb}audio{display:block;width:100%;margin-top:12px}textarea{width:100%;height:100px}small{display:block}</style><h1>SpeechEdit codec experiment</h1><p>Real speech, CPU encoding. The WAVs below are listening copies, not the proposed download format. Record exact mistakes in names, numbers, and simultaneous speakers before making any codec decision.</p><article>Reference<audio controls src="reference.wav"></audio></article>${candidates.map(c => `<article><strong>${escape(String(c.name))}</strong> · ${Number(c.bytes).toLocaleString()} bytes · encode ${Number(c.encodeMs).toFixed(0)} ms · decode ${Number(c.decodeMs).toFixed(0)} ms<small>${escape(String(c.browser))}</small><audio controls src="${c.decoded}"></audio><label>Errors and listening notes<textarea></textarea></label></article>`).join('')}`)
console.log(JSON.stringify(result, null, 2))

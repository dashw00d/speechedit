import type { IncomingMessage } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

/** A single encoding boundary for local takes and collaborator submissions. */
export async function encodeRecording(req: IncomingMessage, ffmpeg = 'ffmpeg'): Promise<{ bytes: Buffer; duration: number }> {
  const duration = Number(req.headers['x-recording-duration'])
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 120) throw new Error('Choose a recording slot between 0.1 and 120 seconds.')
  if (req.headers['content-type'] !== 'audio/wav') throw new Error('Upload a microphone WAV recording.')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 24_000_044) throw new Error('Recording is too large. Choose a shorter passage.'); chunks.push(chunk) }
  const wav = Buffer.concat(chunks)
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 16) !== 'WAVEfmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt32LE(40) !== wav.length - 44) throw new Error('Invalid microphone recording.')
  const rate = wav.readUInt32LE(24)
  if (rate < 8000 || rate > 96000 || Math.abs((wav.length - 44) / 2 / rate - duration) > 0.02) throw new Error('Recording length does not match its slot.')
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-recording-'))
  try {
    const input = join(dir, 'take.wav'), output = join(dir, 'take.mp3')
    await writeFile(input, wav, { mode: 0o600 })
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'wav', '-i', input, '-map', '0:a:0', '-af', `aresample=48000,apad,atrim=end_sample=${Math.round(duration * 48000)},asetpts=N/SR/TB`, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', output], { stdio: ['ignore', 'ignore', 'pipe'] })
      let error = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Recording preparation timed out. Retry this take.')) }, 30000)
      child.stderr.on('data', chunk => { error = (error + chunk).slice(-1000) })
      child.once('error', err => { clearTimeout(timer); reject(err) })
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Could not prepare the MP3 recording. ${error}`)) })
    })
    return { bytes: await readFile(output), duration }
  } finally { await rm(dir, { recursive: true, force: true }) }
}

import { describe, expect, test } from 'bun:test'
import { applyCommand } from '../renderer/src/lib/commands'
import { createEmptyProject } from '../renderer/src/lib/demo'
import { wordsFromAsr } from '../renderer/src/lib/asr'
import { ensureLocalWhisper } from './asrLocal'
import { transcribeMedia } from './transcribe'

describe('local whisper.cpp', () => {
  test('transcribes speech to word times and lands on the command bus', async () => {
    const ready = await ensureLocalWhisper({ sample: true })
    expect(ready.bin).toContain('whisper-cli')
    expect(ready.model).toMatch(/ggml-tiny\.en\.bin$/)
    expect(ready.sample).toBeTruthy()

    const cues = await transcribeMedia(ready.sample!, {
      kind: 'whisper-cpp',
      model: ready.model
    })
    expect(cues?.length).toBeGreaterThan(4)
    const text = (cues ?? []).map((c) => c.text).join(' ')
    expect(text).toMatch(/america|american|fellow|ask|country/i)
    expect(cues![0].end).toBeGreaterThan(cues![0].start)
    const wordLevel = (cues ?? []).filter((c) => !/\s/.test(c.text.trim())).length
    expect(wordLevel).toBeGreaterThan((cues?.length ?? 0) * 0.5)

    const words = wordsFromAsr(cues)
    const project = applyCommand(createEmptyProject('jfk'), { type: 'setTranscript', words })
    expect(project.transcript.words.length).toBe(words.length)
    expect(project.transcript.words[0].start).toBe(words[0].start)
  }, 180000)

  test('default whisper-cli setting falls back to local whisper.cpp on an mp4', async () => {
    const ready = await ensureLocalWhisper({ sample: true })
    const ffmpeg = Bun.which('ffmpeg')
    if (!ffmpeg) throw new Error('ffmpeg required')
    await Bun.$`${ffmpeg} -y -f lavfi -i color=c=black:s=160x120:r=10 -i ${ready.sample!} -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/se-jfk.mp4`.quiet()
    const cues = await transcribeMedia('/tmp/se-jfk.mp4', { kind: 'whisper-cli' })
    expect(cues?.length).toBeGreaterThan(4)
    expect((cues ?? []).map((c) => c.text).join(' ')).toMatch(/america|american|fellow|ask/i)
  }, 180000)
})

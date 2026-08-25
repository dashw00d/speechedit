import { useEffect, useState, type ReactNode } from 'react'
import { host, isElectron } from '../host'
import { wordsFromAsr } from '../lib/asr'
import { extractJson } from '../lib/providers'
import { intelligencePrompt, parseIntelligence } from '../lib/intelligence'
import { planIntent } from '../lib/intent'
import {
  INTEL_PRESETS,
  TRANSCRIPT_PRESETS,
  loadSettings,
  saveSettings,
  type AppSettings
} from '../lib/settings'
import { presetIdFor } from '../../../shared/asr'
import { applyCommand } from '../lib/commands'
import { useEditor } from '../store'

export function ModelsPanel({ onToast }: { onToast: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [busy, setBusy] = useState<string | null>(null)
  const [pathStatus, setPathStatus] = useState<{ kind: string; available: boolean; found: string[] }[]>(
    []
  )

  useEffect(() => {
    void host.asrPath().then(setPathStatus).catch(() => undefined)
  }, [])

  function update(next: AppSettings) {
    const saved = saveSettings(next)
    setSettings(saved)
    void host.syncSettings(saved).catch(() => undefined)
  }

  async function transcribeAgain() {
    const asset = Object.values(project.assets).find((a) => a.path)
    if (!asset?.path) {
      onToast('Open media first.')
      return
    }
    setBusy('transcribe')
    try {
      const cues = await host.transcribe(asset.path, settings.transcript)
      const words = wordsFromAsr(cues, project.transcript.speakers[0]?.id ?? 'ryan')
      if (!words.length) throw new Error('No transcript came back. Check the provider, or use speech islands.')
      useEditor.getState().loadTranscript(words)
      onToast(`Transcript · ${words.length} words`)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Transcribe failed.')
    } finally {
      setBusy(null)
    }
  }

  async function ask(intent?: string) {
    const promptIntent =
      intent ?? window.prompt('What should SpeechEdit do? (scenes, retakes, or “cut the ums”)') ?? ''
    if (!promptIntent && settings.intelligence.kind === 'off') {
      onToast('Type a request, or turn on a local/API model.')
      return
    }
    setBusy('intel')
    try {
      if (settings.intelligence.kind === 'openai-compatible' && settings.intelligence.baseUrl) {
        const prompt = intelligencePrompt(project, promptIntent || undefined)
        const text = await host.complete({
          endpoint: settings.intelligence,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ]
        })
        const draft = parseIntelligence(extractJson(text))
        let next = applyCommand(project, {
          type: 'mergeIntelligence',
          scenes: draft.scenes,
          suggestions: draft.suggestions
        })
        next = draft.commands.reduce((acc, command) => applyCommand(acc, command), next)
        dispatch({ type: 'replaceProject', project: next })
        onToast(draft.notes || `Model · ${draft.scenes.length} scenes · ${draft.suggestions.length} cuts`)
        return
      }
      const plan = planIntent(project, promptIntent)
      plan.commands.forEach((command) => dispatch(command))
      onToast(plan.note)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Model failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p className="help">
        File → Open media uses this provider and lands Word[] on the project. Local OSS CLIs spawn
        from PATH; Groq / OpenAI / Speaches use the same OpenAI-spec HTTP call. Missing ASR falls
        back to speech islands.
      </p>
      <Field label="Transcript">
        <select
          value={presetIdFor(settings.transcript.kind, settings.transcript.baseUrl)}
          onChange={(e) => {
            const preset = TRANSCRIPT_PRESETS.find((p) => p.id === e.target.value)
            if (!preset) return
            update({
              ...settings,
              transcript: {
                ...settings.transcript,
                kind: preset.kind,
                baseUrl: preset.baseUrl,
                model: preset.model || settings.transcript.model
              }
            })
          }}
        >
          {TRANSCRIPT_PRESETS.map((p) => {
            const status = pathStatus.find((s) => s.kind === p.kind)
            const mark =
              p.kind === 'whisper-cpp' || p.kind === 'mlx-whisper'
                ? status?.available
                  ? ''
                  : ' — not on PATH'
                : ''
            return (
              <option key={p.id} value={p.id}>
                {p.label}
                {mark}
              </option>
            )
          })}
        </select>
      </Field>
      <p className="help">{TRANSCRIPT_PRESETS.find((p) => p.id === presetIdFor(settings.transcript.kind, settings.transcript.baseUrl))?.hint}</p>
      {settings.transcript.kind !== 'off' && (
        <Field label={settings.transcript.kind === 'openai-compatible' ? 'ASR model' : 'CLI model'}>
          <input
            value={settings.transcript.model}
            placeholder={settings.transcript.kind === 'whisper-cpp' ? 'optional ggml .bin path' : 'base'}
            onChange={(e) =>
              update({ ...settings, transcript: { ...settings.transcript, model: e.target.value } })
            }
          />
        </Field>
      )}
      {settings.transcript.kind === 'openai-compatible' && (
        <>
          <Field label="ASR URL">
            <input
              value={settings.transcript.baseUrl}
              onChange={(e) =>
                update({ ...settings, transcript: { ...settings.transcript, baseUrl: e.target.value } })
              }
            />
          </Field>
          <Field label="ASR key">
            <input
              type="password"
              value={settings.transcript.apiKey}
              onChange={(e) =>
                update({ ...settings, transcript: { ...settings.transcript, apiKey: e.target.value } })
              }
            />
          </Field>
        </>
      )}
      <Field label="Intelligence">
        <select
          value={settings.intelligence.kind === 'off' ? 'off' : settings.intelligence.baseUrl}
          onChange={(e) => {
            const preset = INTEL_PRESETS.find((p) => p.id === e.target.value || p.baseUrl === e.target.value)
            if (!preset) return
            update({
              ...settings,
              intelligence: {
                ...settings.intelligence,
                kind: preset.kind,
                baseUrl: preset.baseUrl || settings.intelligence.baseUrl,
                model: preset.model || settings.intelligence.model
              }
            })
          }}
        >
          {INTEL_PRESETS.map((p) => (
            <option key={p.id} value={p.id === 'off' ? 'off' : p.id === 'local' || p.id === 'ollama' ? p.baseUrl : p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {settings.intelligence.kind === 'openai-compatible' && (
        <>
          <Field label="LLM URL">
            <input
              value={settings.intelligence.baseUrl}
              onChange={(e) =>
                update({
                  ...settings,
                  intelligence: { ...settings.intelligence, baseUrl: e.target.value }
                })
              }
            />
          </Field>
          <Field label="LLM model">
            <input
              value={settings.intelligence.model}
              onChange={(e) =>
                update({ ...settings, intelligence: { ...settings.intelligence, model: e.target.value } })
              }
            />
          </Field>
          <Field label="LLM key">
            <input
              type="password"
              value={settings.intelligence.apiKey}
              onChange={(e) =>
                update({ ...settings, intelligence: { ...settings.intelligence, apiKey: e.target.value } })
              }
            />
          </Field>
        </>
      )}
      <div className="script-tools" style={{ padding: 0 }}>
        <button className="chip" disabled={Boolean(busy)} onClick={() => void transcribeAgain()}>
          {busy === 'transcribe' ? 'Transcribing…' : 'Transcribe again'}
        </button>
        <button className="chip" disabled={Boolean(busy)} onClick={() => void ask()}>
          {busy === 'intel' ? 'Thinking…' : 'Ask model…'}
        </button>
        <button className="chip" disabled={Boolean(busy)} onClick={() => void ask('Group scenes and mark retakes. Do not cut yet.')}>
          Find scenes
        </button>
      </div>
      <p className="help">
        MCP: <code>bun src/mcp/server.ts</code>
        {isElectron ? ' · live project in ~/.speechedit/current.speechedit.json' : ' · save a project JSON and set SPEECHEDIT_PROJECT'}
      </p>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

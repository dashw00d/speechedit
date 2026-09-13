import { transcribeCurrentRecording } from '../lib/transcribeAction'
import { useEffect, useState, type ReactNode } from 'react'
import { host, isElectron } from '../host'
import {
  INTEL_PRESETS,
  TRANSCRIPT_PRESETS,
  loadSettings,
  saveSettings,
  type AppSettings
} from '../lib/settings'
import { presetIdFor } from '../../../shared/asr'
import { useEditor } from '../store'
import { failActivity, finishActivity, startActivity } from '../lib/activity'
import { useBrowserWhisperState } from '../lib/browserWhisper'

type IntelligenceModel = {
  id: string
  capabilities: string[]
  parameterSize?: string
  contextLength?: number
  remote?: boolean
  detail?: string
}

export function ModelsPanel({ onToast }: { onToast: (msg: string) => void }) {
  const project = useEditor((s) => s.project)
  const dispatch = useEditor((s) => s.dispatch)
  const analyzing = useEditor((s) => s.analyzing)
  const exporting = useEditor((s) => s.exporting)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [modelBusy, setModelBusy] = useState<'list' | 'test' | null>(null)
  const [intelModels, setIntelModels] = useState<IntelligenceModel[]>([])
  const [modelStatus, setModelStatus] = useState<{ state: 'ok' | 'info' | 'error'; message: string } | null>(null)
  const [pathStatus, setPathStatus] = useState<{ kind: string; available: boolean; found: string[] }[]>(
    []
  )
  const browserWhisper = useBrowserWhisperState()

  useEffect(() => {
    void host.asrPath().then(setPathStatus).catch(() => undefined)
    const endpoint = loadSettings().intelligence
    if (endpoint.kind !== 'off') void inspectModels(endpoint, true)
  }, [])

  function update(next: AppSettings) {
    const saved = saveSettings(next)
    setSettings(saved)
    void host.syncSettings(saved).catch(() => undefined)
    return saved
  }

  function useDiscoveredModel(model: string) {
    setSettings((current) => {
      const saved = saveSettings({
        ...current,
        intelligence: { ...current.intelligence, model }
      })
      void host.syncSettings(saved).catch(() => undefined)
      return saved
    })
  }

  async function inspectModels(endpoint = settings.intelligence, repair = false) {
    if (endpoint.kind === 'openai-compatible' && !endpoint.baseUrl) return
    setModelBusy('list')
    startActivity({ id: 'system:model-check', label: 'Checking Assistant models', detail: endpoint.model || endpoint.kind })
    setModelStatus({ state: 'info', message: 'Checking the model endpoint…' })
    let keepErrorVisible = false
    try {
      const status = await host.listModels(endpoint)
      setIntelModels(status.models)
      if (!status.models.length) {
        setModelStatus({ state: 'error', message: 'Connected, but this endpoint reports no models.' })
        return
      }
      let selected =
        endpoint.kind === 'codex-cli' || endpoint.kind === 'grok-cli'
          ? status.models[0]
          : status.models.find((model) => model.id === endpoint.model)
      if (!selected && repair && endpoint.kind === 'openai-compatible') {
        selected = status.models[0]
        useDiscoveredModel(selected.id)
      }
      if (!selected) {
        setModelStatus({
          state: 'error',
          message: `${endpoint.model || 'The selected model'} is not available. Choose one of the detected models.`
        })
        return
      }
      const facts = [
        status.provider === 'ollama'
          ? 'Ollama connected'
          : status.provider === 'codex-cli'
            ? 'Codex CLI ready'
            : status.provider === 'grok-cli'
              ? 'Grok CLI ready'
              : 'Endpoint connected',
        selected.detail || '',
        selected.remote ? 'cloud' : '',
        selected.parameterSize || '',
        selected.contextLength ? `${Math.round(selected.contextLength / 1000)}k context` : '',
        selected.capabilities.length ? selected.capabilities.join(' · ') : ''
      ].filter(Boolean)
      setModelStatus({ state: 'ok', message: facts.join(' · ') })
    } catch (err) {
      setIntelModels([])
      failActivity('system:model-check', err instanceof Error ? err.message : 'Could not inspect the model endpoint.')
      keepErrorVisible = true
      setModelStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Could not inspect the model endpoint.'
      })
    } finally {
      setModelBusy(null)
      if (!keepErrorVisible) finishActivity('system:model-check')
    }
  }

  async function testModel() {
    setModelBusy('test')
    setModelStatus({
      state: 'info',
      message: 'Running a real structured reply. Cloud models may take a minute…'
    })
    try {
      const result = await host.testModel(settings.intelligence)
      setModelStatus({
        state: 'ok',
        message: `${result.model} answered correctly in ${(result.latencyMs / 1000).toFixed(1)}s.`
      })
    } catch (err) {
      setModelStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'The model test failed.'
      })
    } finally {
      setModelBusy(null)
    }
  }


  return (
    <div className="models-panel">
      <section className="project-settings-section" data-kind="whisper">
        <header className="project-settings-heading">
          <span>
            <strong>Whisper transcription</strong>
            <small>Turns spoken audio into editable words</small>
          </span>
          <b data-state={browserWhisper.state === 'error' || settings.transcript.kind === 'off' ? 'off' : 'ready'}>
            {!isElectron
              ? browserWhisper.state === 'ready'
                ? 'Ready'
                : browserWhisper.state === 'transcribing'
                  ? 'Listening'
                  : browserWhisper.state === 'error'
                    ? 'Retry'
                    : 'Starting'
              : settings.transcript.kind === 'off' ? 'Off' : 'On'}
          </b>
        </header>
        <p className="help">
          {isElectron
            ? 'Open media uses this provider automatically. Transcription is separate from the Assistant model. If Whisper is unavailable, SpeechEdit shows approximate speech regions instead of inventing words.'
            : 'Private transcription starts when the site opens. The model is cached in this browser, then every recording is transcribed locally without uploading it.'}
        </p>
      {!isElectron && (
        <div className="model-check" data-state={browserWhisper.state === 'error' ? 'error' : browserWhisper.state === 'ready' ? 'ok' : 'info'}>
          <div>
            <strong>Whisper tiny.en · on this device</strong>
            <span>{browserWhisper.detail}</span>
            {browserWhisper.fallbackReason && <small>{browserWhisper.fallbackReason} Transcription runs locally in compatibility mode.</small>}
          </div>
          {browserWhisper.state === 'loading' && browserWhisper.ratio != null && (
            <progress max={1} value={browserWhisper.ratio} aria-label={`${Math.round(browserWhisper.ratio * 100)}%`} />
          )}
        </div>
      )}
      {isElectron && (
      <>
      <Field label="Whisper provider">
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
                model: preset.model
              }
            })
          }}
        >
          {TRANSCRIPT_PRESETS.map((p) => {
            const status = pathStatus.find((s) => s.kind === p.kind)
            const cli = p.kind !== 'off' && p.kind !== 'openai-compatible'
            const mark = !status
              ? ''
              : status.available
                ? p.kind === 'whisper-cpp'
                  ? ' — ready'
                  : ''
                : cli
                  ? ' — not installed'
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
      </>
      )}
      <div className="project-settings-actions">
        <button
          className="chip"
          disabled={Boolean(analyzing) || exporting || (isElectron && settings.transcript.kind === 'off')}
          onClick={() => void transcribeCurrentRecording(onToast)}
        >
          {Boolean(analyzing?.startsWith('transcript')) ? 'Transcribing…' : 'Transcribe current media'}
        </button>
        <small>{isElectron ? 'Transcribes the selected recording and adds missing chapters. Undo restores its previous transcript.' : 'Runs locally using the model already warming in the background.'}</small>
      </div>
      </section>

      <section className="project-settings-section" data-kind="intelligence">
        <header className="project-settings-heading">
          <span>
            <strong>Assistant intelligence</strong>
            <small>Plans edits and calls SpeechEdit tools</small>
          </span>
          <b data-state={settings.intelligence.kind === 'off' ? 'off' : 'ready'}>
            {settings.intelligence.kind === 'off' ? 'Off' : 'On'}
          </b>
        </header>
        <p className="help">This model never transcribes audio. It only answers questions and plans editor actions.</p>
      {!isElectron ? (
        <div className="model-check" data-state={modelStatus?.state ?? 'idle'}>
          <div>
            <strong>Demo AI · Free</strong>
            <span>
              {modelStatus?.message ??
                'A server-managed free model plans edits. The provider, model, and credential are fixed for this demo.'}
            </span>
          </div>
          <div className="script-tools" style={{ padding: 0 }}>
            <button className="chip" type="button" disabled={Boolean(modelBusy)} onClick={() => void inspectModels()}>
              {modelBusy === 'list' ? 'Checking…' : 'Check availability'}
            </button>
            <button className="chip" type="button" disabled={Boolean(modelBusy)} onClick={() => void testModel()}>
              {modelBusy === 'test' ? 'Testing…' : 'Test Demo AI'}
            </button>
          </div>
        </div>
      ) : (
      <>
      <Field label="Assistant provider">
        <select
          value={
            settings.intelligence.kind === 'off'
              ? 'off'
              : settings.intelligence.kind === 'codex-cli' || settings.intelligence.kind === 'grok-cli'
                ? settings.intelligence.kind
                : settings.intelligence.baseUrl
          }
          onChange={(e) => {
            const preset = INTEL_PRESETS.find((p) => p.id === e.target.value || p.baseUrl === e.target.value)
            if (!preset) return
            const saved = update({
              ...settings,
              intelligence: {
                ...settings.intelligence,
                kind: preset.kind,
                baseUrl:
                  preset.kind === 'codex-cli' || preset.kind === 'grok-cli'
                    ? ''
                    : preset.baseUrl || settings.intelligence.baseUrl,
                model:
                  preset.kind === 'codex-cli' || preset.kind === 'grok-cli'
                    ? preset.model
                    : preset.model || settings.intelligence.model
              }
            })
            setModelStatus(null)
            setIntelModels([])
            if (saved.intelligence.kind !== 'off') {
              void inspectModels(saved.intelligence, preset.id === 'ollama')
            }
          }}
        >
          {settings.intelligence.kind === 'openai-compatible' &&
            !INTEL_PRESETS.some((p) => p.baseUrl === settings.intelligence.baseUrl) && (
              <option value={settings.intelligence.baseUrl}>Custom endpoint</option>
            )}
          {INTEL_PRESETS.map((p) => (
            <option
              key={p.id}
              value={
                p.id === 'off' || p.kind === 'codex-cli' || p.kind === 'grok-cli' ? p.id : p.baseUrl
              }
            >
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
              onChange={(e) => {
                setModelStatus(null)
                update({
                  ...settings,
                  intelligence: { ...settings.intelligence, baseUrl: e.target.value }
                })
              }}
            />
          </Field>
          <Field label="LLM model">
            <input
              list="speechedit-intelligence-models"
              value={settings.intelligence.model}
              onChange={(e) => {
                setModelStatus(null)
                update({ ...settings, intelligence: { ...settings.intelligence, model: e.target.value } })
              }}
            />
            <datalist id="speechedit-intelligence-models">
              {intelModels.map((model) => <option key={model.id} value={model.id} />)}
            </datalist>
          </Field>
          <Field label="LLM key">
            <input
              type="password"
              value={settings.intelligence.apiKey}
              onChange={(e) => {
                setModelStatus(null)
                update({ ...settings, intelligence: { ...settings.intelligence, apiKey: e.target.value } })
              }}
            />
          </Field>
        </>
      )}
      {(settings.intelligence.kind === 'codex-cli' || settings.intelligence.kind === 'grok-cli') && (
        <Field label="CLI model (optional)">
          <input
            value={settings.intelligence.model}
            placeholder="Use the CLI default"
            onChange={(e) => {
              setModelStatus(null)
              update({ ...settings, intelligence: { ...settings.intelligence, model: e.target.value } })
            }}
          />
        </Field>
      )}
      {settings.intelligence.kind !== 'off' && (
        <div className="model-check" data-state={modelStatus?.state ?? 'idle'}>
          <div>
            <strong>Assistant model</strong>
            <span>
              {modelStatus?.message ??
                (settings.intelligence.kind === 'openai-compatible'
                  ? 'Check which models are available, then run one real reply.'
                  : 'Check the installed CLI and account, then run one real reply.')}
            </span>
          </div>
          <div className="script-tools" style={{ padding: 0 }}>
            <button className="chip" type="button" disabled={Boolean(modelBusy)} onClick={() => void inspectModels()}>
              {modelBusy === 'list'
                ? 'Checking…'
                : settings.intelligence.kind === 'openai-compatible'
                  ? 'Refresh models'
                  : 'Check CLI'}
            </button>
            <button
              className="chip"
              type="button"
              disabled={
                Boolean(modelBusy) ||
                (settings.intelligence.kind === 'openai-compatible' && !settings.intelligence.model)
              }
              onClick={() => void testModel()}
            >
              {modelBusy === 'test' ? 'Testing…' : 'Test real reply'}
            </button>
          </div>
        </div>
      )}
      </>
      )}
      </section>

      <details className="project-settings-section project-technical">
        <summary>Developer integration</summary>
        <p className="help">
          MCP: <code>bun src/mcp/server.ts</code>
          {isElectron ? ' · live project in ~/.speechedit/current.speechedit.json' : ' · save a project JSON and set SPEECHEDIT_PROJECT'}
        </p>
      </details>
    </div>
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

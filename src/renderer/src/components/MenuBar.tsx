import { isSharedEditor } from '../lib/sharedSession'
import { useEffect, type ReactNode } from 'react'
import { shortcutLabel } from '../lib/keyboard'
import { isElectron } from '../host'
import { confirmLoseWork, currentDocumentTitle, saveCurrentDocument } from '../lib/documentIo'
import { appendTakeAction, importMediaAction, importTimelineAction, openProjectAction, openRecentAction, openTranscriptAction, wireFileEvents } from '../lib/fileActions'
import { listRecents } from '../lib/recents'
import { cancelExport, ffmpegImportBusy } from '../lib/mediaJobs'
import { openPreferences } from '../lib/theme'
import { useEditor } from '../store'
import { openAssistant } from '../lib/assistantNavigation'
import { useActivityJobs } from '../lib/activity'
import { OverflowMenu } from './OverflowMenu'

interface Props {
  onToast: (msg: string) => void
  onShare?: () => void
  onExport: () => void
  exporting: boolean
  onShortcuts?: () => void
}

export function MenuBar({ onToast, onExport, onShare, exporting, onShortcuts }: Props) {
  const project = useEditor((s) => s.project)
  const dirty = useEditor((s) => s.dirty)
  const analyzing = useEditor((s) => s.analyzing)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const past = useEditor((s) => s.past.length)
  const future = useEditor((s) => s.future.length)
  const newProject = useEditor((s) => s.newProject)
  const loadDemo = useEditor((s) => s.loadDemo)
  const documentPath = useEditor((s) => s.documentPath)
  const setPalette = useEditor((s) => s.setPalette)
  const recents = listRecents()
  const activities = useActivityJobs()
  const primaryActivity = activities.find((job) => job.state === 'running') ?? activities[0]

  useEffect(() => wireFileEvents(onToast), [onToast])

  return (
      <header className="menubar">
      <div className="brand">
        <span className="brand-mark">
          Speech<em>Edit</em>
        </span>
        <span className="brand-sub">the only program</span>
      </div>
      <nav className="menu-cluster">
        <Menu label="File">
          <span className="menu-label">New & open</span>
          <Item
            onClick={() => {
              void confirmLoseWork().then((ok) => {
                if (ok) newProject()
              })
            }}
          >
            New reel
          </Item>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void importMediaAction(onToast)}>
            Open media…
          </Item>
          <Item onClick={() => void openProjectAction(onToast)}>Open project…</Item>
          <span className="menu-label">Import into this project</span>
          <Item disabled={Boolean(analyzing) || exporting} onClick={() => void appendTakeAction(onToast)}>
            Add take…
          </Item>
          <Item onClick={() => void openTranscriptAction(onToast)}>Open transcript…</Item>
          <Item onClick={() => void importTimelineAction(onToast)}>Import timeline…</Item>
          <span className="menu-label">Save & export</span>
          <Item
            onClick={async () => {
              try {
                const path = await saveCurrentDocument()
                if (path) onToast(isSharedEditor() ? 'Saved to the shared project.' : isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`)
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Save failed.')
              }
            }}
          >
            Save
          </Item>
          <Item
            onClick={async () => {
              try {
                const path = await saveCurrentDocument({ saveAs: true })
                if (path) onToast(isSharedEditor() ? 'Saved to the shared project.' : isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`)
              } catch (err) {
                onToast(err instanceof Error ? err.message : 'Save failed.')
              }
            }}
          >
            Save As…
          </Item>
          <Item disabled={ffmpegImportBusy(analyzing)} onClick={onExport}>
            Export…
          </Item>
          <span className="menu-label">Try it</span>
          <Item
            onClick={() => {
              void confirmLoseWork().then((ok) => {
                if (ok) loadDemo()
              })
            }}
          >
            Open studio demo
          </Item>
          {recents.length > 0 && (
            <>
              <span className="menu-label">Recent</span>
              {recents.map((recent) => (
                <Item key={recent.path} onClick={() => void openRecentAction(recent.path, onToast)}>
                  {recent.name}
                </Item>
              ))}
            </>
          )}
        </Menu>
        <Menu label="Edit">
          <Item disabled={!past} onClick={undo}>Undo {shortcutLabel('⌘Z')}</Item>
          <Item disabled={!future} onClick={redo}>Redo {shortcutLabel('⌘⇧Z')}</Item>
          <span className="menu-label">Edit the whole reel</span>
          <Item onClick={() => window.dispatchEvent(new Event('speechedit:quick-edit'))}>Quick edit presets…</Item>
          <span className="menu-label">Find tools</span>
          <Item onClick={() => setPalette(true)}>Find a command… {shortcutLabel('⌘K')}</Item>
          <Item onClick={() => useEditor.getState().setReviewing(true)}>Review edits…</Item>
          <Item onClick={openAssistant}>Ask assistant… {shortcutLabel('⌘J')}</Item>
        </Menu>
        <Menu label="View">
          <span className="menu-label">Workspace</span>
          {(['script', 'preview', 'timeline', 'review'] as const).map((pane) => (
            <Item key={pane} onClick={() => window.dispatchEvent(new CustomEvent('speechedit:workspace-pane', { detail: pane }))}>
              {{ script: 'Transcript', preview: 'Preview', timeline: 'Timeline', review: 'Inspector' }[pane]}
            </Item>
          ))}
          <span className="menu-label">Settings & help</span>
          <Item onClick={() => window.dispatchEvent(new Event('speechedit:project-settings'))}>Project settings…</Item>
          <Item onClick={() => openPreferences()}>Appearance & preferences…</Item>
          {onShare && <button type="button" className="tool-btn" onClick={onShare}>Share</button>}
        {onShortcuts && <Item onClick={onShortcuts}>Editing help & shortcuts…</Item>}
        </Menu>
      </nav>
      <div className="menubar-right">
        <div className="history-controls" role="group" aria-label="Edit history">
          <button type="button" className="tool-btn" disabled={!past} title={shortcutLabel('Undo last edit (⌘Z)')} onClick={() => { undo(); onToast('Undid the last edit. Redo puts it back.') }}>Undo</button>
          <button type="button" className="tool-btn" disabled={!future} title={shortcutLabel('Redo last edit (⌘⇧Z)')} onClick={() => { redo(); onToast('Redid the edit.') }}>Redo</button>
        </div>
        <button type="button" className="tool-btn" title={shortcutLabel('Save project (⌘S) — keeps your edits so you can continue later')} onClick={() => {
          void saveCurrentDocument().then(
            (path) => { if (path) onToast(isSharedEditor() ? 'Saved to the shared project.' : isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`) },
            (err: unknown) => onToast(err instanceof Error ? err.message : 'Save failed.')
          )
        }}>Save{dirty ? ' •' : ''}</button>
        {onShare && <button type="button" className="tool-btn" onClick={onShare}>Share</button>}
        {onShortcuts && <button type="button" className="tool-btn" title="Editing help and keyboard shortcuts (?)" onClick={onShortcuts}>Help</button>}
        <button type="button"
          className="status-pill"
          data-dirty={dirty || !documentPath || undefined}
          data-working={Boolean(primaryActivity) || undefined}
          data-clickable={Boolean(primaryActivity || dirty || !documentPath) || undefined}
          title={
            primaryActivity
              ? 'Open Project activity'
              : dirty || !documentPath
                ? 'Save this reel'
                : documentPath
          }
          onClick={() => {
            if (primaryActivity) {
              window.dispatchEvent(new Event('speechedit:project-settings'))
              return
            }
            if (!dirty && documentPath) return
            void saveCurrentDocument().then(
              (path) => {
                if (path) onToast(isSharedEditor() ? 'Saved to the shared project.' : isElectron ? `Saved ${currentDocumentTitle()}.` : `Downloaded ${path}`)
              },
              (err: unknown) => onToast(err instanceof Error ? err.message : 'Save failed.')
            )
          }}
        >
          {primaryActivity
            ? `${primaryActivity.label}${activities.length > 1 ? ` · +${activities.length - 1}` : ''}`
            : analyzing
              ? `Working · ${analyzing}`
            : dirty || !documentPath
              ? 'Not saved'
              : 'Saved'}{' '}
          · {documentPath ? currentDocumentTitle() : project.name} · {Math.max(1, Math.round(project.sourceDuration))} sec
</button>
        <button
          className="export-btn"
          onClick={exporting ? () => void cancelExport() : onExport}
          disabled={ffmpegImportBusy(analyzing) && !exporting}
        >
          {exporting ? 'Cancel' : 'Export'}
        </button>
      </div>
      </header>
  )
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return <OverflowMenu label={label} title={`${label} menu`} tone="menu" place="below">{children}</OverflowMenu>
}

function Item({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button className="overflow-item" type="button" disabled={disabled} onClick={onClick}>{children}</button>
}

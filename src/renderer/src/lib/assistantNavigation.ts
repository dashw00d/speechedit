import { useEditor } from '../store'

export function openAssistant(): void {
  useEditor.getState().setInspectorTab('agent')
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('speechedit:assistant'))
}

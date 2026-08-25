import { useEditor } from '../store'

export const YOUTUBE_FRAME = { width: 1920, height: 1080 }
export const VERTICAL_FRAME = { width: 1080, height: 1920 }

export type FrameKind = 'youtube' | 'vertical'

export function isVerticalFrame(project: { width: number; height: number }): boolean {
  return project.height > project.width
}

export function describeFrame(kind: FrameKind): string {
  if (kind === 'vertical') {
    return 'Tall 9:16 frame. Drag the picture to pick the face. Safe keeps captions inside.'
  }
  return 'Wide 16:9 frame — YouTube 1080.'
}

export function setFrameFromContext(kind: FrameKind): { toast: string; kind: FrameKind } {
  const editor = useEditor.getState()
  if (kind === 'vertical') {
    editor.dispatch({ type: 'setCanvas', ...VERTICAL_FRAME })
    editor.setShowSafeZone(true)
  } else {
    editor.dispatch({ type: 'setCanvas', ...YOUTUBE_FRAME })
  }
  return { toast: describeFrame(kind), kind }
}

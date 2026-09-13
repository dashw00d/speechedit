type GpuAccess = { requestAdapter: () => Promise<unknown | null> }

/** API presence alone does not mean the browser can actually use a GPU. */
export async function browserGpuUnavailableReason(
  secure: boolean,
  gpu?: GpuAccess
): Promise<string | undefined> {
  if (!secure) return 'GPU acceleration requires HTTPS. Open the secure site address.'
  if (!gpu) return 'This browser does not expose WebGPU. Try a browser with GPU acceleration enabled.'
  try {
    if (!await gpu.requestAdapter()) {
      return 'The browser could not access a GPU. Check browser graphics acceleration and device drivers.'
    }
  } catch (error) {
    return `GPU access failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

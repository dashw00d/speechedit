import { host, isElectron } from '../host'
import { downloadText } from './interchange'

export async function saveTextExport(filename: string, body: string): Promise<string | null> {
  if (isElectron) {
    const path = await host.chooseTextExport(filename)
    if (!path) return null
    await host.writeText(path, body)
    return path
  }
  downloadText(filename, body)
  return filename
}

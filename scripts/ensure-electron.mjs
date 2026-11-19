#!/usr/bin/env bun
// Makes sure Electron's binary is downloaded and extracted.
//
// Electron fetches its binary from a `postinstall` script (`node install.js`). Under some Node
// versions (observed with Node 26) that script exits 0 halfway through extracting the zip, so
// `bun install` "succeeds" but `node_modules/electron/path.txt` is never written and
// `bun run dev` fails with "Electron failed to install correctly". Re-running the same installer
// with Bun's runtime completes the extraction. Safe to run repeatedly.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD || !existsSync(join(electronDir, 'install.js'))) process.exit(0)
if (existsSync(join(electronDir, 'path.txt'))) process.exit(0)

console.log('Electron binary missing; running its installer with Bun.')
const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], { cwd: electronDir, stdio: 'inherit' })
if (result.status !== 0 || !existsSync(join(electronDir, 'path.txt'))) {
  console.error('Electron binary install failed. Check your network connection, then run `bun scripts/ensure-electron.mjs`.')
  // Never fail `bun install` for this; `bun run dev` surfaces the problem with a clear message.
  process.exit(process.argv.includes('--strict') ? 1 : 0)
}

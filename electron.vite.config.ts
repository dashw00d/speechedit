import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function packageVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version?: unknown }
    return typeof raw.version === 'string' ? raw.version : '0.1.0'
  } catch {
    return '0.1.0'
  }
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const buildIdentity = {
  'process.env.SPEECHEDIT_VERSION': JSON.stringify(packageVersion()),
  'process.env.SPEECHEDIT_COMMIT': JSON.stringify(gitCommit())
}

export default defineConfig({
  main: {
    define: buildIdentity,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react()]
  }
})

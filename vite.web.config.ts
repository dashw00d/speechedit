import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: { '@': resolve('src/renderer/src') }
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true }
})

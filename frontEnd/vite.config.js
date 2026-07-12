import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  // Use the physical project path so Vite/Rolldown emits index.html relative to
  // this app even when the process is launched through a Windows workspace shim.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
})

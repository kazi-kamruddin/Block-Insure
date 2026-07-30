import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  // Use the physical project path so Vite/Rolldown emits index.html relative to
  // this app even when the process is launched through a Windows workspace shim.
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "wallet",
              test: /node_modules[\\/]ethers/,
              priority: 3,
              maxSize: 350_000,
            },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|react-router|@tanstack)/,
              priority: 2,
              maxSize: 300_000,
            },
            {
              name: "vendor",
              test: /node_modules/,
              priority: 1,
              maxSize: 350_000,
            },
          ],
        },
      },
    },
  },
})

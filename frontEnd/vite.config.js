import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // Use the physical project path so Vite/Rolldown emits index.html relative to
  // this app even when the process is launched through a Windows workspace shim.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Keep Vite's shared dynamic-import helper out of the PDF chunk;
              // otherwise every lazy route would pull the renderer in eagerly.
              name: "preload-runtime",
              test: /vite[\\/]preload-helper/,
              priority: 5,
            },
            {
              name: "pdf-preview",
              test: /node_modules[\\/]pdfjs-dist/,
              priority: 4,
            },
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
});

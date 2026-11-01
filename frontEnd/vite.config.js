import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Only these already-public fields are emitted; never serialize the environment.
function publicReleaseConfiguration() {
  let body;
  return {
    name: "public-release-configuration",
    configResolved(config) {
      const env = config.env;
      const api = env.VITE_API_BASE_URL;
      const apiOrigin = api && /^https?:/.test(api) ? new URL(api).origin : "same-origin";
      body = JSON.stringify({ schema: "block-insure-public-release-v1", chainId: String(env.VITE_CHAIN_ID || 31337), apiOrigin,
        managerAddress: env.VITE_CONTRACT_ADDRESS || "", economicsAddress: env.VITE_POLICY_ECONOMICS_ADDRESS || "",
        evidenceRegistryAddress: env.VITE_EVIDENCE_REGISTRY_ADDRESS || "", benefitsAddress: env.VITE_POLICY_BENEFITS_ADDRESS || "" });
    },
    configureServer(server) {
      server.middlewares.use("/release-config.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json"); response.setHeader("Cache-Control", "no-store"); response.end(body);
      });
    },
    generateBundle() { this.emitFile({ type: "asset", fileName: "release-config.json", source: body }); },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Use the physical project path so Vite/Rolldown emits index.html relative to
  // this app even when the process is launched through a Windows workspace shim.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), publicReleaseConfiguration()],
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

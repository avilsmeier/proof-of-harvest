import path from "path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteCommonjs } from "@originjs/vite-plugin-commonjs";
import compression from "compression";
import type { Connect } from "vite";

/**
 * Neither `vite dev` nor `vite preview` gzip responses on their own. This app
 * ships multi-megabyte WASM (the ledger WASM alone is ~10MB uncompressed,
 * ~4.6MB gzipped) to a browser that, for this project, is reached over the
 * open internet rather than localhost — without this, every load re-sends
 * the uncompressed payload.
 */
function gzipMiddleware(): Plugin {
  // `compression()` is typed against Express's Request/Response, but at
  // runtime it only touches the plain Node req/res/next signature that
  // Vite's Connect-based middleware stack actually provides.
  const middleware = compression() as unknown as Connect.NextHandleFunction;
  return {
    name: "gzip-responses",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    viteCommonjs(),
    nodePolyfills({
      include: ["buffer", "process", "util", "crypto", "stream"],
    }),
    gzipMiddleware(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "esnext",
  },
  server: {
    // This dev VM is headless; the user reaches it remotely from their own
    // machine's browser (with Lace installed), so the server must bind all
    // interfaces, not just localhost.
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
});

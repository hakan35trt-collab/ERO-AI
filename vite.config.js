import { defineConfig } from "vite";
import { eroServiceWorker } from "./scripts/sw-plugin.js";

// Project site: https://hakan35trt-collab.github.io/ERO-AI/
const pagesBase = process.env.ERO_BASE || "/ERO-AI/";

export default defineConfig(({ command }) => {
  const base = command === "build" ? pagesBase : "./";
  return {
    base,
    plugins: [eroServiceWorker(base)],
    define: {
      __ERO_BUILD__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      host: "0.0.0.0",
      port: 8731,
      strictPort: true,
    },
    preview: {
      host: "0.0.0.0",
      port: 8731,
      strictPort: true,
    },
  };
});

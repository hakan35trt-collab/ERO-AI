import { defineConfig } from "vite";
import { eroServiceWorker } from "./scripts/sw-plugin.js";

export default defineConfig({
  base: "./",
  plugins: [eroServiceWorker()],
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
});

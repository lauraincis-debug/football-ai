import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handleGemini } from "./server/gemini.mjs";

export default defineConfig({
  base: "/",
  plugins: [react(), {name: "gemini-api", configureServer(server) { server.middlewares.use(handleGemini); }, configurePreviewServer(server) { server.middlewares.use(handleGemini); }}],
  build: {
    outDir: "www",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
});

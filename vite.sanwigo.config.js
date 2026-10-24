import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

// Même patron que vite.cloe-app.config.js : SanwiGo est une application
// autonome du mono-projet (build séparé -> sanwigo-www), sans toucher
// au build Football AI (www) ni à Cloé (cloe-www).
export default defineConfig({
  plugins: [
    react(),
    {
      name: "rename-sanwigo-index-html",
      closeBundle() {
        const srcHtml = path.resolve("sanwigo-www/sanwigo-index.html");
        const dstHtml = path.resolve("sanwigo-www/index.html");
        if (fs.existsSync(srcHtml)) {
          fs.renameSync(srcHtml, dstHtml);
        }
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4174,
    allowedHosts: true,
  },
  build: {
    outDir: "sanwigo-www",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: path.resolve("sanwigo-index.html"),
    },
  },
});

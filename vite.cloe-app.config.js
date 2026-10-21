import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "rename-cloe-index-html",
      closeBundle() {
        const srcHtml = path.resolve("cloe-www/cloe-index.html");
        const dstHtml = path.resolve("cloe-www/index.html");
        if (fs.existsSync(srcHtml)) {
          fs.renameSync(srcHtml, dstHtml);
        }
      },
    },
  ],
  build: {
    outDir: "cloe-www",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: path.resolve("cloe-index.html"),
    },
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "www",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: "src/services/cloeBridge.js",
      name: "CloeFootballModule",
      formats: ["iife"],
      fileName: () => "cloe-bridge.js",
    },
  },
});

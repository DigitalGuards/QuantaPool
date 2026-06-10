import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import nodePolyfills from "rollup-plugin-node-polyfills";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
      // Node polyfills required by @theqrl/web3 in the browser
      stream: "rollup-plugin-node-polyfills/polyfills/stream",
      buffer: "rollup-plugin-node-polyfills/polyfills/buffer-es6",
      events: "rollup-plugin-node-polyfills/polyfills/events",
      util: "rollup-plugin-node-polyfills/polyfills/util",
      process: "rollup-plugin-node-polyfills/polyfills/process-es6",
    },
  },
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },
  optimizeDeps: {
    include: ["buffer", "process", "events", "util"],
  },
  build: {
    rollupOptions: {
      // The polyfill plugin ships pre-rollup-3 types; the runtime shape is fine.
      plugins: [nodePolyfills() as unknown as import("rollup").Plugin],
      output: {
        manualChunks(id: string) {
          if (id.includes("@radix-ui")) return "vendor-radix";
          // ~600 KB of post-quantum crypto — keep out of the initial chunk
          if (id.includes("@theqrl/web3")) return "vendor-qrl-web3";
          if (id.includes("mobx")) return "vendor-mobx";
          if (id.includes("react-dom/")) return "vendor-react-dom";
        },
      },
    },
  },
}));

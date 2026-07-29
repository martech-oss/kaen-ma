import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    tailwindcss(),
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
    }),
    tanstackStart(),
    react(),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});

import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
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

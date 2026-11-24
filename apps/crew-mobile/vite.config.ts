import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./src", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true, target: "es2022" },
  server: { port: 5190, strictPort: false, host: "127.0.0.1" },
});

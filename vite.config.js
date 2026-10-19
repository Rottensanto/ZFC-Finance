import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/ZFC-Finance/" : "/",
  build: { outDir: "dist", sourcemap: false },
}));
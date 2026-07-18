import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      exclude: ["src/generated/**"],
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "html"],
    },
    environment: "node",
    globals: false,
    server: {
      deps: {
        inline: ["obsidian-daily-notes-interface"],
      },
    },
  },
});

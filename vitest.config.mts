import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "**/*.obsidian.test.{ts,tsx}"] },
      },
      {
        extends: true,
        resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/mocks/obsidian.ts", import.meta.url)) } },
        test: {
          name: "obsidian",
          include: ["tests/**/*.obsidian.test.{ts,tsx}"],
          server: { deps: { inline: ["obsidian-daily-notes-interface"] } },
        },
      },
    ],
    pool: "threads",
    ...(process.env["CI"] ? { maxWorkers: 1, sequence: { shuffle: true } } : {}),
    fsModuleCache: true,
    isolate: false,
    coverage: {
      exclude: ["src/generated/**"],
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text"],
    },
    environment: "node",
    globals: false,
  },
});

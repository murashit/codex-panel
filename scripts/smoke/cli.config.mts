import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/smoke/cli.smoke.ts"],
    environment: "jsdom",
    testTimeout: 45000,
  },
});

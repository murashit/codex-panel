export default {
  // This local plugin needs no extra package. Knip ignores its inferred package name.
  // Remove it when Stryker's Vitest 5 fix is released; see the script for links.
  testRunner: "vitest5",
  appendPlugins: ["./scripts/stryker-vitest5-runner.mjs"],
  coverageAnalysis: "perTest",
  // Local history and generated reports are not test inputs.
  ignorePatterns: ["/.jj", "/coverage"],
  mutate: [
    "src/domain/**/*.ts",
    "src/app-server/**/*.ts",
    "src/features/chat/domain/**/*.ts",
    "src/features/chat/app-server/**/*.ts",
    "src/features/chat/application/**/*.ts",
    "src/features/threads/**/*.ts",
    "src/features/selection-rewrite/**/*.ts",
    "src/shared/async/**/*.ts",
    "src/shared/vault/**/*.ts",
    "src/settings/**/*.ts",
  ],
  ignoreStatic: true,
  incremental: true,
  reporters: ["clear-text", "progress", "html"],
};

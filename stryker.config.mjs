export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.mts" },
  disableBail: true,
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
  incrementalFile: "reports/mutation-baseline/stryker-incremental.json",
  reporters: ["clear-text", "progress", "html"],
};

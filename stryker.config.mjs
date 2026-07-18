export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  mutate: ["src/domain/**/*.ts", "src/features/chat/domain/**/*.ts"],
  ignoreStatic: true,
  incremental: true,
  reporters: ["clear-text", "progress", "html"],
};

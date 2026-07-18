export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  mutate: [
    "src/domain/**/*.ts",
    "src/app-server/protocol/**/*.ts",
    "src/features/chat/domain/**/*.ts",
    "src/features/chat/app-server/mappers/thread-stream/**/*.ts",
    "src/features/chat/application/state/root-reducer.ts",
  ],
  ignoreStatic: true,
  incremental: true,
  reporters: ["clear-text", "progress", "html"],
};

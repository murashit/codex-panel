export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  mutate: [
    "src/domain/**/*.ts",
    "src/app-server/protocol/**/*.ts",
    "src/features/chat/domain/**/*.ts",
    "src/features/chat/app-server/mappers/thread-stream/**/*.ts",
    "src/features/chat/application/state/root-reducer.ts",
    "src/app-server/query/active-thread-inventory.ts",
    "src/app-server/query/snapshots.ts",
    "src/features/chat/app-server/thread-reference-resolver.ts",
    "src/features/threads/workflows/**/*.ts",
  ],
  ignoreStatic: true,
  incremental: true,
  reporters: ["clear-text", "progress", "html"],
};

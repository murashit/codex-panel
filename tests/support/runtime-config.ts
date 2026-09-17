import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../src/domain/runtime/settings";

export function runtimeConfigFixture(overrides: Partial<RuntimeConfigSnapshot> = {}): RuntimeConfigSnapshot {
  return {
    ...runtimeConfigOrDefault(null),
    ...overrides,
  };
}

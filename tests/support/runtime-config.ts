import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../src/domain/runtime/config";

export function runtimeConfigFixture(overrides: Partial<RuntimeConfigSnapshot> = {}): RuntimeConfigSnapshot {
  return {
    ...runtimeConfigOrDefault(null),
    ...overrides,
  };
}

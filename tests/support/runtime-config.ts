import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../src/app-server/protocol/runtime-config";
import { type RuntimeConfigSnapshot, runtimeConfigOrDefault } from "../../src/domain/runtime/settings";

export function runtimeConfigFixture(overrides: Partial<RuntimeConfigSnapshot> = {}): RuntimeConfigSnapshot {
  return {
    ...runtimeConfigOrDefault(null),
    ...overrides,
  };
}

export function runtimeConfigFromAppServerFixture(config: Record<string, unknown>): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers: null,
  });
}

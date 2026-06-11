import { describe, expect, it } from "vitest";

import { createAppServerDiagnostics } from "../../src/app-server/diagnostics";
import { emptyRuntimeConfigSnapshot } from "../../src/app-server/runtime-config";
import {
  applySharedAppServerMetadata,
  applySharedModels,
  applySharedThreadList,
  cachedSharedAppServerMetadata,
  cachedSharedModels,
  cachedSharedThreadList,
  createSharedAppServerState,
  type SharedAppServerCacheContext,
} from "../../src/app-server/shared-cache-state";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import type { Thread } from "../../src/domain/threads/model";

describe("shared app-server cache state", () => {
  it("keeps snapshots detached from caller-owned arrays", () => {
    const sourceThreads = [threadFixture("thread-1")];
    const threadState = applySharedThreadList(createSharedAppServerState(), cacheContext(), sourceThreads);
    sourceThreads.push(threadFixture("thread-2"));

    const cachedThreads = cachedSharedThreadList(threadState, cacheContext());
    expect(cachedThreads?.map((thread) => thread.id)).toEqual(["thread-1"]);

    const mutableCachedThreads = cachedThreads as Thread[];
    mutableCachedThreads.push(threadFixture("thread-3"));
    expect(cachedSharedThreadList(threadState, cacheContext())?.map((thread) => thread.id)).toEqual(["thread-1"]);

    const sourceModels = [modelFixture("gpt-5.5")];
    const modelState = applySharedModels(createSharedAppServerState(), cacheContext(), sourceModels);
    sourceModels.push(modelFixture("gpt-5.6"));
    expect(cachedSharedModels(modelState, cacheContext()).map((model) => model.model)).toEqual(["gpt-5.5"]);
    const cachedModels = cachedSharedModels(modelState, cacheContext());
    (cachedModels[0]?.supportedReasoningEfforts as string[] | undefined)?.push("high");
    expect(cachedSharedModels(modelState, cacheContext())[0]?.supportedReasoningEfforts).toEqual([]);

    const metadataState = applySharedAppServerMetadata(createSharedAppServerState(), cacheContext(), {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableModels: sourceModels,
      availableSkills: [{ name: "skill", description: "", path: "/tmp/skill", enabled: true }],
      rateLimit: null,
      appServerDiagnostics: {
        ...createAppServerDiagnostics(),
        mcpServers: [{ name: "server", startupStatus: "ready", authStatus: null, toolCount: 1, message: null }],
      },
    });
    sourceModels.push(modelFixture("gpt-5.7"));
    const cachedMetadata = cachedSharedAppServerMetadata(metadataState, cacheContext());
    expect(cachedMetadata?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5", "gpt-5.6"]);
  });

  it("does not return snapshots for a different app-server cache context", () => {
    const state = applySharedModels(
      applySharedThreadList(createSharedAppServerState(), cacheContext(), [threadFixture("thread-1")]),
      cacheContext(),
      [modelFixture("gpt-5.5")],
    );

    expect(cachedSharedThreadList(state, cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cachedSharedModels(state, cacheContext({ codexPath: "/opt/codex" }))).toEqual([]);
    expect(cachedSharedThreadList(state, cacheContext({ appServerUserAgent: "codex-cli/9.9.9" }))).toBeNull();
    expect(cachedSharedModels(state, cacheContext({ appServerUserAgent: "codex-cli/9.9.9" }))).toEqual([]);
  });
});

function cacheContext(overrides: Partial<SharedAppServerCacheContext> = {}): SharedAppServerCacheContext {
  return {
    codexPath: "codex",
    vaultPath: "/vault",
    appServerUserAgent: "codex-cli/1.2.3",
    ...overrides,
  };
}

function threadFixture(id: string): Thread {
  return {
    id,
    preview: "",
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function modelFixture(model: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

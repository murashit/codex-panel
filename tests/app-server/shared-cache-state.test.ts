import { describe, expect, it } from "vitest";

import { createAppServerDiagnostics } from "../../src/app-server/compatibility";
import {
  applySharedAppServerMetadata,
  applySharedModels,
  applySharedThreadList,
  cachedSharedAppServerMetadata,
  cachedSharedModels,
  cachedSharedThreadList,
  createSharedAppServerState,
} from "../../src/app-server/shared-cache-state";
import type { PanelThread } from "../../src/domain/threads/model";
import type { Model } from "../../src/generated/app-server/v2/Model";
import type { Thread } from "../../src/generated/app-server/v2/Thread";

describe("shared app-server cache state", () => {
  it("keeps snapshots detached from caller-owned arrays", () => {
    const sourceThreads = [threadFixture("thread-1")];
    const threadState = applySharedThreadList(createSharedAppServerState(), sourceThreads);
    sourceThreads.push(threadFixture("thread-2"));

    const cachedThreads = cachedSharedThreadList(threadState);
    expect(cachedThreads?.map((thread) => thread.id)).toEqual(["thread-1"]);

    const mutableCachedThreads = cachedThreads as PanelThread[];
    mutableCachedThreads.push(threadFixture("thread-3"));
    expect(cachedSharedThreadList(threadState)?.map((thread) => thread.id)).toEqual(["thread-1"]);

    const sourceModels = [modelFixture("gpt-5.5")];
    const modelState = applySharedModels(createSharedAppServerState(), sourceModels);
    sourceModels.push(modelFixture("gpt-5.6"));
    expect(modelState.availableModels.map((model) => model.model)).toEqual(["gpt-5.5"]);
    const cachedModels = cachedSharedModels(modelState);
    cachedModels[0]?.supportedReasoningEfforts.push({ reasoningEffort: "high", description: "High" });
    expect(cachedSharedModels(modelState)[0]?.supportedReasoningEfforts).toEqual([]);

    const metadataState = applySharedAppServerMetadata(createSharedAppServerState(), {
      effectiveConfig: null,
      availableModels: sourceModels,
      availableSkills: [{ name: "skill", description: "", path: "/tmp/skill", scope: "repo", enabled: true }],
      rateLimit: null,
      appServerDiagnostics: {
        ...createAppServerDiagnostics(),
        mcpServers: [{ name: "server", startupStatus: "ready", authStatus: null, toolCount: 1, message: null }],
      },
    });
    sourceModels.push(modelFixture("gpt-5.7"));
    const cachedMetadata = cachedSharedAppServerMetadata(metadataState);
    expect(cachedMetadata?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5", "gpt-5.6"]);
  });
});

function threadFixture(id: string): Thread & { archived: boolean } {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    archived: false,
    turns: [],
  };
}

function modelFixture(model: string): Model {
  return {
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: [],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

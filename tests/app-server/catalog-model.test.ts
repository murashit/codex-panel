import { describe, expect, it } from "vitest";

import {
  appServerHookOperationFromPanelHookItem,
  panelHookItemsFromAppServerHooks,
  panelModelOptionsFromAppServerModels,
  panelSkillOptionsFromAppServerSkills,
} from "../../src/app-server/catalog-model";
import type { HookMetadata } from "../../src/generated/app-server/v2/HookMetadata";
import type { Model } from "../../src/generated/app-server/v2/Model";
import type { SkillMetadata } from "../../src/generated/app-server/v2/SkillMetadata";

describe("app-server catalog model mappers", () => {
  it("maps app-server models to panel model options", () => {
    expect(panelModelOptionsFromAppServerModels([modelFixture()])).toEqual([
      {
        id: "gpt-5.5-id",
        model: "gpt-5.5",
        displayName: "GPT 5.5",
        description: "Primary model",
        hidden: false,
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "high",
        inputModalities: ["text"],
        additionalSpeedTiers: ["fast"],
        serviceTiers: [{ id: "priority", name: "Fast" }],
        defaultServiceTier: "priority",
        isDefault: true,
      },
    ]);
  });

  it("preserves unknown app-server default reasoning efforts as raw catalog metadata", () => {
    const model = { ...modelFixture(), defaultReasoningEffort: "extreme" as never };

    expect(panelModelOptionsFromAppServerModels([model])[0]?.defaultReasoningEffort).toBe("extreme");
  });

  it("maps app-server skills to composer skill options", () => {
    expect(panelSkillOptionsFromAppServerSkills([skillFixture()])).toEqual([
      {
        name: "writer",
        description: "Write notes",
        shortDescription: "Write",
        interfaceShortDescription: "Draft",
        path: "/skills/writer",
        enabled: true,
      },
    ]);
  });

  it("maps app-server hooks to settings hook items", () => {
    expect(panelHookItemsFromAppServerHooks([hookFixture()])).toEqual([
      {
        key: "hook-key",
        eventName: "postToolUse",
        matcher: "apply_patch",
        command: "node hook.js",
        statusMessage: null,
        sourcePath: "/vault/.codex/hooks.json",
        enabled: true,
        isManaged: false,
        currentHash: "hash",
        trustStatus: "modified",
      },
    ]);
  });

  it("maps panel hook items to minimal app-server hook operations", () => {
    const hook = panelHookItemsFromAppServerHooks([hookFixture()])[0];
    if (!hook) throw new Error("Expected mapped hook");

    expect(appServerHookOperationFromPanelHookItem(hook)).toEqual({
      key: "hook-key",
      currentHash: "hash",
      trustStatus: "modified",
    });
  });
});

function modelFixture(): Model {
  return {
    id: "gpt-5.5-id",
    model: "gpt-5.5",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: "GPT 5.5",
    description: "Primary model",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "high", description: "High" },
    ],
    defaultReasoningEffort: "high",
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: ["fast"],
    serviceTiers: [{ id: "priority", name: "Fast", description: "Fast tier" }],
    defaultServiceTier: "priority",
    isDefault: true,
  };
}

function skillFixture(): SkillMetadata {
  return {
    name: "writer",
    description: "Write notes",
    shortDescription: "Write",
    interface: { shortDescription: "Draft" },
    path: "/skills/writer",
    scope: "repo",
    enabled: true,
  };
}

function hookFixture(): HookMetadata {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    timeoutSec: 10n,
    statusMessage: null,
    sourcePath: "/vault/.codex/hooks.json",
    source: "project",
    pluginId: null,
    displayOrder: 0n,
    enabled: true,
    isManaged: false,
    currentHash: "hash",
    trustStatus: "modified",
  };
}

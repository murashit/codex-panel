import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../src/app-server/connection/client";
import {
  appServerHookOperationFromHookItem,
  hookItemsFromCatalogHooks,
  modelMetadataFromCatalogModels,
  skillMetadataFromCatalogSkills,
} from "../../src/app-server/protocol/catalog";
import { listHookCatalog, listSkillCatalog } from "../../src/app-server/services/catalog";
import type { HookMetadata } from "../../src/generated/app-server/v2/HookMetadata";
import type { Model } from "../../src/generated/app-server/v2/Model";
import type { SkillMetadata } from "../../src/generated/app-server/v2/SkillMetadata";

describe("app-server catalog mappers", () => {
  it("maps app-server models to panel model options", () => {
    expect(modelMetadataFromCatalogModels([modelFixture()])).toEqual([
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

    expect(modelMetadataFromCatalogModels([model])[0]?.defaultReasoningEffort).toBe("extreme");
  });

  it("maps app-server skills to composer skill options", () => {
    expect(skillMetadataFromCatalogSkills([skillFixture()])).toEqual([
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
    expect(hookItemsFromCatalogHooks([hookFixture()])).toEqual([
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
    const hook = hookItemsFromCatalogHooks([hookFixture()])[0];
    if (!hook) throw new Error("Expected mapped hook");

    expect(appServerHookOperationFromHookItem(hook)).toEqual({
      key: "hook-key",
      currentHash: "hash",
      trustStatus: "modified",
    });
  });
});

describe("app-server catalog adapters", () => {
  it("returns enabled skill options while preserving total app-server skill count", async () => {
    const client = {
      listSkills: vi.fn().mockResolvedValue({
        data: [
          {
            cwd: "/vault",
            skills: [
              { name: "enabled", description: "Enabled skill", path: "/skills/enabled", scope: "repo", enabled: true },
              { name: "disabled", description: "Disabled skill", path: "/skills/disabled", scope: "repo", enabled: false },
            ],
          },
        ],
      }),
    } as unknown as AppServerClient;

    await expect(listSkillCatalog(client, "/vault")).resolves.toMatchObject({
      skills: [{ name: "enabled", description: "Enabled skill", path: "/skills/enabled", enabled: true }],
      totalCount: 2,
    });
  });

  it("uses only hook rows for the requested cwd", async () => {
    const client = {
      listHooks: vi.fn().mockResolvedValue({
        data: [
          { cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] },
          { cwd: "/vault", hooks: [{ key: "vault" }], warnings: ["warn"], errors: [{ message: "err" }] },
        ],
      }),
    } as unknown as AppServerClient;

    await expect(listHookCatalog(client, "/vault")).resolves.toMatchObject({
      hooks: [{ key: "vault" }],
      warnings: ["warn"],
      errors: ['{"message":"err"}'],
    });
  });

  it("does not fall back to unrelated hook rows", async () => {
    const client = {
      listHooks: vi.fn().mockResolvedValue({
        data: [{ cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] }],
      }),
    } as unknown as AppServerClient;

    await expect(listHookCatalog(client, "/vault")).resolves.toEqual({
      hooks: [],
      warnings: [],
      errors: [],
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

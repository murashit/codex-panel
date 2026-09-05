import { describe, expect, it, vi } from "vitest";
import {
  hookItemsFromCatalogHooks,
  modelMetadataFromCatalogModels,
  skillMetadataFromCatalogSkills,
} from "../../../src/app-server/protocol/catalog";
import {
  listHookCatalog,
  listModelMetadata,
  listSkillCatalog,
  setHookItemEnabled,
  trustHookItem,
} from "../../../src/app-server/services/catalog";
import type { AppServerRequestClient } from "../../../src/app-server/services/request-client";
import type { HookMetadata } from "../../../src/generated/app-server/v2/HookMetadata";
import type { Model } from "../../../src/generated/app-server/v2/Model";
import type { SkillMetadata } from "../../../src/generated/app-server/v2/SkillMetadata";

describe("app-server catalog mappers", () => {
  it("maps app-server models to panel model options", () => {
    expect(modelMetadataFromCatalogModels([modelFixture()])).toEqual([
      {
        id: "gpt-5.5-id",
        model: "gpt-5.5",
        displayName: "GPT 5.5",
        description: "Primary model",
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Low" },
          { reasoningEffort: "high", description: "High" },
        ],
        defaultReasoningEffort: "high",
        inputModalities: ["text"],
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
        handlerSummary: "node hook.js",
        statusMessage: null,
        sourcePath: "/vault/.codex/hooks.json",
        enabled: true,
        isManaged: false,
        currentHash: "hash",
        trustStatus: "modified",
      },
    ]);
  });

  it("maps MCP tool hooks through their shared settings metadata", () => {
    const hook: HookMetadata = {
      ...hookFixture(),
      handlerType: "mcpTool",
      server: "github",
      tool: "search_code",
    };

    expect(hookItemsFromCatalogHooks([hook])).toMatchObject([
      {
        key: "hook-key",
        eventName: "postToolUse",
        matcher: "apply_patch",
        handlerSummary: "github/search_code",
        trustStatus: "modified",
      },
    ]);
  });
});

describe("app-server catalog adapters", () => {
  it("loads every model page", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [modelFixture({ id: "first-id", model: "first" })], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [modelFixture({ id: "second-id", model: "second" })], nextCursor: null });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(listModelMetadata(client)).resolves.toMatchObject([{ model: "first" }, { model: "second" }]);
    expect(request).toHaveBeenNthCalledWith(1, "model/list", { includeHidden: false, cursor: null, limit: 100 });
    expect(request).toHaveBeenNthCalledWith(2, "model/list", { includeHidden: false, cursor: "next", limit: 100 });
  });

  it("rejects repeated model cursors", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ data: [modelFixture()], nextCursor: "repeat" }),
    } as unknown as AppServerRequestClient;

    await expect(listModelMetadata(client)).rejects.toThrow("repeated model list cursor");
  });

  it("returns enabled skill options while preserving total app-server skill count", async () => {
    const client = {
      request: vi.fn(async () => ({
        data: [
          {
            cwd: "/vault",
            skills: [
              { name: "enabled", description: "Enabled skill", path: "/skills/enabled", scope: "repo", enabled: true },
              { name: "disabled", description: "Disabled skill", path: "/skills/disabled", scope: "repo", enabled: false },
            ],
          },
        ],
      })),
    } as unknown as AppServerRequestClient;

    await expect(listSkillCatalog(client, "/vault")).resolves.toMatchObject({
      skills: [{ name: "enabled", description: "Enabled skill", path: "/skills/enabled", enabled: true }],
      totalCount: 2,
    });
    expect(client.request).toHaveBeenCalledWith("skills/list", { cwds: ["/vault"], forceReload: false });
  });

  it("uses only hook rows for the requested cwd", async () => {
    const client = {
      request: vi.fn(async () => ({
        data: [
          { cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] },
          { cwd: "/vault", hooks: [{ key: "vault" }], warnings: ["warn"], errors: [{ message: "err" }] },
        ],
      })),
    } as unknown as AppServerRequestClient;

    await expect(listHookCatalog(client, "/vault")).resolves.toMatchObject({
      hooks: [{ key: "vault" }],
      warnings: ["warn"],
      errors: ['{"message":"err"}'],
    });
    expect(client.request).toHaveBeenCalledWith("hooks/list", { cwds: ["/vault"] });
  });

  it("does not fall back to unrelated hook rows", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [{ cwd: "/other", hooks: [{ key: "other" }], warnings: ["skip"], errors: [{ message: "skip" }] }],
      }),
    } as unknown as AppServerRequestClient;

    await expect(listHookCatalog(client, "/vault")).resolves.toEqual({
      hooks: [],
      warnings: [],
      errors: [],
    });
  });

  it("writes trusted hook state through config batch updates", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({}),
    } as unknown as AppServerRequestClient;
    const hook = hookItemsFromCatalogHooks([
      hookFixture({ key: "hook-trust", currentHash: "newhash", enabled: false, trustStatus: "modified" }),
    ])[0];
    if (!hook) throw new Error("Expected mapped hook");

    await trustHookItem(client, hook);

    expect(client.request).toHaveBeenCalledWith("config/batchWrite", {
      edits: [
        {
          keyPath: "hooks.state",
          value: {
            "hook-trust": {
              trusted_hash: "newhash",
            },
          },
          mergeStrategy: "upsert",
        },
      ],
      reloadUserConfig: true,
    });
  });

  it("updates hook enablement without rewriting independently managed trust state", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({}),
    } as unknown as AppServerRequestClient;
    const hook = hookItemsFromCatalogHooks([hookFixture({ key: "hook-enabled", currentHash: "trustedhash", trustStatus: "trusted" })])[0];
    if (!hook) throw new Error("Expected mapped hook");

    await setHookItemEnabled(client, hook, false);

    expect(client.request).toHaveBeenCalledWith("config/batchWrite", {
      edits: [
        {
          keyPath: "hooks.state",
          value: {
            "hook-enabled": {
              enabled: false,
            },
          },
          mergeStrategy: "upsert",
        },
      ],
      reloadUserConfig: true,
    });
  });

  it("rejects enablement changes for untrusted hook revisions", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({}),
    } as unknown as AppServerRequestClient;
    const hook = hookItemsFromCatalogHooks([
      hookFixture({ key: "hook-modified", currentHash: "modifiedhash", trustStatus: "modified" }),
    ])[0];
    if (!hook) throw new Error("Expected mapped hook");

    await expect(setHookItemEnabled(client, hook, true)).rejects.toThrow("Trust the current hook definition before enabling it.");
    expect(client.request).not.toHaveBeenCalled();
  });
});

function modelFixture(overrides: Partial<Model> = {}): Model {
  return {
    id: "gpt-5.5-id",
    model: "gpt-5.5",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: "GPT 5.5",
    description: "Primary model",
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "high", description: "High" },
    ],
    defaultReasoningEffort: "high",
    inputModalities: ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: [],
    serviceTiers: [{ id: "priority", name: "Fast", description: "Fast tier" }],
    defaultServiceTier: "priority",
    isDefault: true,
    ...overrides,
  };
}

function skillFixture(): SkillMetadata {
  return {
    name: "writer",
    description: "Write notes",
    shortDescription: "Write",
    interface: { shortDescription: "Draft", iconSmallUrl: null, iconLargeUrl: null },
    path: "/skills/writer",
    scope: "repo",
    enabled: true,
    pluginId: null,
  };
}

type CommandHookMetadata = Extract<HookMetadata, { handlerType: "command" }>;

function hookFixture(overrides: Partial<CommandHookMetadata> = {}): CommandHookMetadata {
  return {
    key: "hook-key",
    eventName: "postToolUse",
    handlerType: "command",
    matcher: "apply_patch",
    command: "node hook.js",
    async: false,
    timeoutSec: 10n,
    statusMessage: null,
    additionalContextLimit: null,
    sourcePath: "/vault/.codex/hooks.json",
    source: "project",
    pluginId: null,
    displayOrder: 0n,
    enabled: true,
    isManaged: false,
    currentHash: "hash",
    trustStatus: "modified",
    ...overrides,
  };
}

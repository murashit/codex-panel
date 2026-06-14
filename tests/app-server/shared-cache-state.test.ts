import { describe, expect, it } from "vitest";

import { createServerDiagnostics, diagnosticProbeError, diagnosticProbeOk } from "../../src/domain/server/diagnostics";
import type { RateLimitSnapshot } from "../../src/app-server/protocol/runtime-metrics";
import { emptyRuntimeConfigSnapshot } from "../../src/app-server/protocol/runtime-config";
import {
  applySharedServerMetadata,
  applySharedModels,
  applySharedThreadList,
  cachedSharedServerMetadata,
  cachedSharedModels,
  cachedSharedThreadList,
  createSharedAppServerState,
  sharedAppServerCacheContextIsComplete,
  type SharedAppServerCacheContext,
} from "../../src/app-server/services/shared-cache-state";
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
    expect(expectPresent(cachedSharedModels(modelState, cacheContext())).map((model) => model.model)).toEqual(["gpt-5.5"]);
    const cachedModels = expectPresent(cachedSharedModels(modelState, cacheContext()));
    (cachedModels[0]?.supportedReasoningEfforts as string[] | undefined)?.push("high");
    expect(expectPresent(cachedSharedModels(modelState, cacheContext()))[0]?.supportedReasoningEfforts).toEqual([]);

    const sourceRateLimit = rateLimitFixture();
    const metadataState = applySharedServerMetadata(createSharedAppServerState(), cacheContext(), {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableModels: sourceModels,
      availableSkills: [{ name: "skill", description: "", path: "/tmp/skill", enabled: true }],
      rateLimit: sourceRateLimit,
      serverDiagnostics: {
        ...diagnostics({}),
        mcpServers: [{ name: "server", startupStatus: "ready", authStatus: null, toolCount: 1, message: null }],
      },
    });
    sourceModels.push(modelFixture("gpt-5.7"));
    if (sourceRateLimit.primary) sourceRateLimit.primary.usedPercent = 99;
    const cachedMetadata = cachedSharedServerMetadata(metadataState, cacheContext());
    expect(cachedMetadata?.availableModels.map((model) => model.model)).toEqual(["gpt-5.5", "gpt-5.6"]);
    expect(cachedMetadata?.rateLimit?.primary?.usedPercent).toBe(42);
    if (cachedMetadata?.rateLimit?.primary) cachedMetadata.rateLimit.primary.usedPercent = 100;
    expect(cachedSharedServerMetadata(metadataState, cacheContext())?.rateLimit?.primary?.usedPercent).toBe(42);
  });

  it("does not return snapshots for a different app-server cache context", () => {
    const state = applySharedModels(
      applySharedThreadList(createSharedAppServerState(), cacheContext(), [threadFixture("thread-1")]),
      cacheContext(),
      [modelFixture("gpt-5.5")],
    );

    expect(cachedSharedThreadList(state, cacheContext({ vaultPath: "/other-vault" }))).toBeNull();
    expect(cachedSharedModels(state, cacheContext({ codexPath: "/opt/codex" }))).toBeNull();
    expect(cachedSharedThreadList(state, cacheContext({ appServerUserAgent: "codex-cli/9.9.9" }))).toBeNull();
    expect(cachedSharedModels(state, cacheContext({ appServerUserAgent: "codex-cli/9.9.9" }))).toBeNull();
  });

  it("does not load or return snapshots before the app-server identity is known", () => {
    const incompleteContexts = [
      cacheContext({ codexPath: "" }),
      cacheContext({ vaultPath: "   " }),
      cacheContext({ appServerUserAgent: null }),
    ];

    expect(sharedAppServerCacheContextIsComplete(cacheContext())).toBe(true);

    for (const incompleteContext of incompleteContexts) {
      expect(sharedAppServerCacheContextIsComplete(incompleteContext)).toBe(false);
      const state = applySharedServerMetadata(
        applySharedModels(
          applySharedThreadList(createSharedAppServerState(), incompleteContext, [threadFixture("thread-1")]),
          incompleteContext,
          [modelFixture("gpt-5.5")],
        ),
        incompleteContext,
        {
          runtimeConfig: emptyRuntimeConfigSnapshot(),
          availableModels: [modelFixture("gpt-5.6")],
          availableSkills: [],
          rateLimit: null,
          serverDiagnostics: createServerDiagnostics(),
        },
      );

      expect(cachedSharedThreadList(state, incompleteContext)).toBeNull();
      expect(cachedSharedModels(state, incompleteContext)).toBeNull();
      expect(cachedSharedServerMetadata(state, incompleteContext)).toBeNull();
    }
  });

  it("merges app-server metadata by successful resource", () => {
    const context = cacheContext();
    const first = applySharedServerMetadata(createSharedAppServerState(), context, {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableModels: [modelFixture("gpt-5.5")],
      availableSkills: [{ name: "writer", description: "", path: "/tmp/writer", enabled: true }],
      rateLimit: rateLimitFixture(),
      serverDiagnostics: diagnostics({}),
    });

    const second = applySharedServerMetadata(first, context, {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableModels: [modelFixture("gpt-5.6")],
      availableSkills: [{ name: "stale", description: "", path: "/tmp/stale", enabled: true }],
      rateLimit: null,
      serverDiagnostics: diagnostics({ skills: "failed", rateLimit: "failed" }),
    });

    const cached = expectPresent(cachedSharedServerMetadata(second, context));
    expect(cached.availableModels.map((model) => model.model)).toEqual(["gpt-5.6"]);
    expect(cached.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cached.rateLimit?.primary?.usedPercent).toBe(42);
    expect(cached.serverDiagnostics.probes["skills/list"].status).toBe("failed");
    expect(cached.serverDiagnostics.probes["account/rateLimits/read"].status).toBe("failed");
    expect(expectPresent(cachedSharedModels(second, context)).map((model) => model.model)).toEqual(["gpt-5.6"]);
  });

  it("loads initial app-server metadata while caching only successful resources", () => {
    const context = cacheContext();
    const state = applySharedServerMetadata(createSharedAppServerState(), context, {
      runtimeConfig: emptyRuntimeConfigSnapshot(),
      availableModels: [modelFixture("failed-model")],
      availableSkills: [{ name: "writer", description: "", path: "/tmp/writer", enabled: true }],
      rateLimit: rateLimitFixture(),
      serverDiagnostics: diagnostics({ models: "failed", rateLimit: "failed" }),
    });

    const cached = expectPresent(cachedSharedServerMetadata(state, context));
    expect(cached.runtimeConfig).not.toBeNull();
    expect(cached.serverDiagnostics.probes["model/list"].status).toBe("failed");
    expect(cached.availableModels).toEqual([]);
    expect(cached.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
    expect(cached.rateLimit).toBeNull();
    expect(cachedSharedModels(state, context)).toBeNull();
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

function expectPresent<T>(value: T | null): T {
  if (value === null) throw new Error("Expected value to be present");
  return value;
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

function rateLimitFixture(): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: "Codex",
    primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1 },
    secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 2 },
    individualLimit: { limit: "100", used: "42", remainingPercent: 58, resetsAt: 3 },
    rateLimitReachedType: null,
  };
}

function diagnostics(overrides: { models?: "ok" | "failed"; skills?: "ok" | "failed"; rateLimit?: "ok" | "failed" }) {
  const next = createServerDiagnostics();
  next.probes["model/list"] =
    overrides.models === "failed" ? diagnosticProbeError("model/list", new Error("offline")) : diagnosticProbeOk("model/list");
  next.probes["skills/list"] =
    overrides.skills === "failed" ? diagnosticProbeError("skills/list", new Error("offline")) : diagnosticProbeOk("skills/list");
  next.probes["account/rateLimits/read"] =
    overrides.rateLimit === "failed"
      ? diagnosticProbeError("account/rateLimits/read", new Error("offline"))
      : diagnosticProbeOk("account/rateLimits/read");
  return next;
}

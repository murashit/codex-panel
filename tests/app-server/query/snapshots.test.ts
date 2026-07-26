import { describe, expect, it } from "vitest";

import {
  cloneModelMetadata,
  cloneRateLimitSnapshot,
  cloneSharedServerMetadataResource,
  cloneThreads,
} from "../../../src/app-server/query/snapshots";
import type { ModelMetadata } from "../../../src/domain/catalog/metadata";
import type { RateLimitSnapshot } from "../../../src/domain/runtime/metrics";
import type { DiagnosticProbeResult } from "../../../src/domain/server/diagnostics";
import type { SharedServerMetadataResource } from "../../../src/domain/server/metadata";
import type { Thread } from "../../../src/domain/threads/model";

describe("app-server query snapshots", () => {
  it("clones thread records without sharing the array", () => {
    const source = [thread("thread")];
    const snapshot = cloneThreads(source);

    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot[0]).not.toBe(source[0]);
  });

  it("clones model arrays, reasoning options, and service tiers", () => {
    const source = [model()];
    const snapshot = cloneModelMetadata(source);

    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot[0]?.supportedReasoningEfforts).not.toBe(source[0]?.supportedReasoningEfforts);
    expect(snapshot[0]?.reasoningEffortOptions).not.toBe(source[0]?.reasoningEffortOptions);
    expect(snapshot[0]?.serviceTiers).not.toBe(source[0]?.serviceTiers);
    expect(snapshot[0]?.serviceTiers[0]).not.toBe(source[0]?.serviceTiers[0]);
    expect(snapshot[0]?.inputModalities).not.toBe(source[0]?.inputModalities);
  });

  it("clones every metadata resource discriminator and nested rate-limit values", () => {
    const resources: SharedServerMetadataResource[] = [
      {
        id: "runtimeConfig",
        value: {
          profile: null,
          model: "gpt",
          modelProvider: null,
          reasoningEffort: null,
          reasoningSummary: null,
          verbosity: null,
          serviceTier: "fast",
          approvalsReviewer: null,
          startupPermissions: {
            approvalPolicy: "never",
            sandboxPolicy: { type: "readOnly", networkAccess: false },
            activePermissionProfile: null,
          },
          modelContextWindow: null,
          autoCompactTokenLimit: null,
        },
      },
      { id: "models", value: [model()], probe: probe() },
      { id: "skills", value: [{ name: "skill", description: "", path: "/tmp/skill", enabled: true }], probe: probe() },
      { id: "permissionProfiles", value: [{ id: "default", description: null, allowed: true }], probe: probe() },
      { id: "rateLimits", value: rateLimit(), probe: probe() },
    ];

    for (const resource of resources) {
      const snapshot = cloneSharedServerMetadataResource(resource);
      expect(snapshot).toEqual(resource);
      expect(snapshot).not.toBe(resource);
      if (resource.id === "rateLimits" && resource.value) {
        const rateLimitSnapshot = snapshot as Extract<SharedServerMetadataResource, { id: "rateLimits" }>;
        expect(rateLimitSnapshot.value).not.toBe(resource.value);
        expect(rateLimitSnapshot.value?.primary).not.toBe(resource.value.primary);
      }
    }
  });

  it("preserves null and undefined resource values", () => {
    expect(cloneSharedServerMetadataResource({ id: "runtimeConfig", value: undefined })).toEqual({
      id: "runtimeConfig",
      value: undefined,
    });
    expect(cloneSharedServerMetadataResource({ id: "models", value: undefined, probe: probe() }).value).toBeUndefined();
    expect(cloneSharedServerMetadataResource({ id: "rateLimits", value: null, probe: probe() }).value).toBeNull();
  });

  it("clones all nested rate-limit windows", () => {
    const source = rateLimit();
    const snapshot = cloneRateLimitSnapshot(source);

    expect(snapshot).toEqual(source);
    expect(snapshot.primary).not.toBe(source.primary);
    expect(snapshot.secondary).not.toBe(source.secondary);
    expect(snapshot.individualLimit).not.toBe(source.individualLimit);
  });
});

function model(): ModelMetadata {
  return {
    id: "gpt",
    model: "gpt",
    displayName: "GPT",
    description: "",
    hidden: false,
    supportedReasoningEfforts: ["medium"],
    reasoningEffortOptions: [{ reasoningEffort: "medium", description: "Balanced" }],
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    serviceTiers: [{ id: "fast", name: "Fast" }],
    defaultServiceTier: "fast",
    isDefault: true,
  };
}

function rateLimit(): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: "Codex",
    primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 1 },
    secondary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 2 },
    individualLimit: { limit: "daily", used: "1", remainingPercent: 90, resetsAt: 3 },
    rateLimitReachedType: null,
  };
}

function probe(): DiagnosticProbeResult {
  return { id: "models", status: "ok", message: "ready", summary: "ready", checkedAt: 1 };
}

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    provenance: { kind: "interactive" },
  };
}

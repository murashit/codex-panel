import { describe, expect, it } from "vitest";

import { emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../src/domain/runtime/config";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { fastModeActive } from "../../src/features/chat/domain/runtime/effective";
import type { RuntimeSnapshot } from "../../src/features/chat/domain/runtime/snapshot";

describe("service tier runtime state", () => {
  it("recognizes Codex fast tier aliases without rejecting other tier ids", () => {
    expect(fastMode("fast")).toBe(true);
    expect(fastMode("priority")).toBe(true);
    expect(fastMode("catalog-fast", [{ id: "catalog-fast", name: "Fast" }])).toBe(true);
    expect(fastMode("priority", [{ id: "priority", name: "Priority" }])).toBe(false);
    expect(fastMode("flex", [{ id: "flex", name: "Flex" }])).toBe(false);
  });

  it("locks the Codex 0.134.0 Fast catalog semantics observed from app-server", () => {
    // Codex app-server 0.134.0 reports Fast as serviceTiers[{ id: "priority", name: "Fast" }].
    const codex01340FastTier = { id: "priority", name: "Fast" };

    expect(fastMode("priority", [codex01340FastTier])).toBe(true);

    // Clearing Fast with serviceTier: null is reported back by 0.134.0 as "default", not null.
    expect(fastMode("default", [codex01340FastTier])).toBe(false);
  });
});

function fastMode(serviceTier: string | null, serviceTiers: ModelMetadata["serviceTiers"] = []): boolean {
  const config: RuntimeConfigSnapshot = { ...emptyRuntimeConfigSnapshot(), model: "gpt-5.5" };
  return fastModeActive(
    {
      runtimeConfig: config,
      activeThreadId: "thread",
      activeModel: "gpt-5.5",
      activeReasoningEffort: null,
      activeCollaborationMode: "default",
      activeServiceTier: serviceTier,
      activeApprovalPolicy: null,
      activeApprovalsReviewer: null,
      activePermissionProfile: null,
      requestedModel: { kind: "unchanged" },
      requestedReasoningEffort: { kind: "unchanged" },
      requestedApprovalsReviewer: { kind: "unchanged" },
      selectedCollaborationMode: "default",
      requestedFastMode: { kind: "unchanged" },
      tokenUsage: null,
      rateLimit: null,
      hasThreadTurns: false,
      availableModels: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "",
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          inputModalities: [],
          additionalSpeedTiers: [],
          serviceTiers,
          defaultServiceTier: null,
        },
      ],
    } satisfies RuntimeSnapshot,
    config,
  );
}

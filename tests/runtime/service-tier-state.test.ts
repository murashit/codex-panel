import { describe, expect, it } from "vitest";
import type { ModelMetadata } from "../../src/domain/catalog/metadata";
import { emptyRuntimeConfigSnapshot, type RuntimeConfigSnapshot } from "../../src/domain/runtime/config";
import { unchangedCollaborationModeIntent } from "../../src/features/chat/domain/runtime/intent";
import { resolveRuntimeControls } from "../../src/features/chat/domain/runtime/resolution";
import type { RuntimeSnapshot } from "../../src/features/chat/domain/runtime/snapshot";

describe("service tier runtime state", () => {
  it.each([
    { name: "built-in fast", serviceTier: "fast", serviceTiers: [], expected: true },
    { name: "built-in priority", serviceTier: "priority", serviceTiers: [], expected: true },
    { name: "catalog Fast tier", serviceTier: "catalog-fast", serviceTiers: [{ id: "catalog-fast", name: "Fast" }], expected: true },
    { name: "catalog Priority tier", serviceTier: "priority", serviceTiers: [{ id: "priority", name: "Priority" }], expected: false },
    { name: "catalog Flex tier", serviceTier: "flex", serviceTiers: [{ id: "flex", name: "Flex" }], expected: false },
  ])("recognizes $name without rejecting other tier ids", ({ serviceTier, serviceTiers, expected }) => {
    expect(fastMode(serviceTier, serviceTiers)).toBe(expected);
  });
});

function fastMode(serviceTier: string | null, serviceTiers: ModelMetadata["serviceTiers"] = []): boolean {
  const config: RuntimeConfigSnapshot = { ...emptyRuntimeConfigSnapshot(), model: "gpt-5.5" };
  return resolveRuntimeControls(
    {
      runtimeConfig: config,
      activeThreadId: "thread",
      active: {
        approvalPolicyKnown: false,
        sandboxPolicyKnown: false,
        permissionProfileKnown: false,
        serviceTierKnown: true,
        model: "gpt-5.5",
        reasoningEffort: null,
        collaborationMode: "default",
        serviceTier,
        approvalsReviewer: null,
        approvalPolicy: null,
        sandboxPolicy: null,
        activePermissionProfile: null,
      },
      pending: {
        model: { kind: "unchanged" },
        reasoningEffort: { kind: "unchanged" },
        permissionProfile: { kind: "unchanged" },
        approvalPolicy: { kind: "unchanged" },
        approvalsReviewer: { kind: "unchanged" },
        collaborationMode: unchangedCollaborationModeIntent(),
        fastMode: { kind: "unchanged" },
      },
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
          serviceTiers,
          defaultServiceTier: null,
        },
      ],
    } satisfies RuntimeSnapshot,
    config,
  ).fastMode.active;
}

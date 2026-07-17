import { describe, expect, it } from "vitest";
import {
  type ActivePanelOperation,
  type ActivePanelThreadFacts,
  activePanelOperationDecisionForFacts,
} from "../../../../src/features/chat/application/panel-operation-policy";

const operations: readonly ActivePanelOperation[] = [
  "submit",
  "start-side-chat",
  "compact",
  "fork",
  "rollback",
  "thread-settings",
  "permission-settings",
  "goal-read",
  "goal-mutation",
  "implement-plan",
];

describe("activePanelOperationDecisionForFacts", () => {
  it("allows every mode-derived operation in an interactive persistent panel", () => {
    expectDecisionKinds({ phase: "active", lifetime: "persistent", provenance: "interactive" }, allAllowed());
  });

  it("keeps side-chat submission and compaction available while blocking persistent-thread mutations", () => {
    expectDecisionKinds(
      { phase: "active", lifetime: "ephemeral", provenance: "interactive" },
      decisions({ submit: "allowed", compact: "allowed" }),
    );
  });

  it("keeps subagent panels read-only", () => {
    expectDecisionKinds({ phase: "active", lifetime: "persistent", provenance: "subagent" }, decisions({ "goal-read": "allowed" }));
  });

  it("keeps the stricter subagent restrictions when mode facts conflict", () => {
    expectDecisionKinds({ phase: "active", lifetime: "ephemeral", provenance: "subagent" }, decisions({}));
  });

  it("requires restoration before a persistent goal mutation", () => {
    expect(activePanelOperationDecisionForFacts({ phase: "awaiting-resume", provenance: "interactive" }, "goal-mutation")).toEqual({
      kind: "resume-required",
    });
  });

  it("keeps restored subagent goals read-only before loading", () => {
    expect(activePanelOperationDecisionForFacts({ phase: "awaiting-resume", provenance: "subagent" }, "goal-mutation")).toEqual({
      kind: "blocked",
      message: "Goals are read-only in agent threads.",
    });
  });

  it("allows empty panels to start a goal-backed thread", () => {
    expectDecisionKinds({ phase: "empty" }, allAllowed());
  });
});

function allAllowed(): Record<ActivePanelOperation, "allowed"> {
  return Object.fromEntries(operations.map((operation) => [operation, "allowed"])) as Record<ActivePanelOperation, "allowed">;
}

function decisions(allowed: Partial<Record<ActivePanelOperation, "allowed">>): Record<ActivePanelOperation, "allowed" | "blocked"> {
  return Object.fromEntries(operations.map((operation) => [operation, allowed[operation] ?? "blocked"])) as Record<
    ActivePanelOperation,
    "allowed" | "blocked"
  >;
}

function expectDecisionKinds(facts: ActivePanelThreadFacts, expected: Record<ActivePanelOperation, "allowed" | "blocked">): void {
  for (const operation of operations) {
    expect(activePanelOperationDecisionForFacts(facts, operation).kind).toBe(expected[operation]);
  }
}

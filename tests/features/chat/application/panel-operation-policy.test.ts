import { describe, expect, it } from "vitest";
import { type ActivePanelOperation, activePanelOperationDecision } from "../../../../src/features/chat/application/panel-operation-policy";
import { type ChatState, createChatState } from "../../../../src/features/chat/application/state/root-reducer";

type ActivePanelThreadFacts =
  | { readonly phase: "empty" }
  | { readonly phase: "awaiting-resume"; readonly provenance: "interactive" | "subagent" | null }
  | {
      readonly phase: "active";
      readonly lifetime: "persistent" | "ephemeral";
      readonly provenance: "interactive" | "subagent" | null;
    };

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
    expect(activePanelOperationDecision(stateFromFacts({ phase: "awaiting-resume", provenance: "interactive" }), "goal-mutation")).toEqual({
      kind: "resume-required",
    });
  });

  it("keeps restored subagent goals read-only before loading", () => {
    expect(activePanelOperationDecision(stateFromFacts({ phase: "awaiting-resume", provenance: "subagent" }), "goal-mutation")).toEqual({
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
    expect(activePanelOperationDecision(stateFromFacts(facts), operation).kind).toBe(expected[operation]);
  }
}

function stateFromFacts(facts: ActivePanelThreadFacts): ChatState {
  const state = createChatState();
  if (facts.phase === "empty") return state;
  const provenance =
    facts.provenance === null
      ? null
      : facts.provenance === "interactive"
        ? ({ kind: "interactive" } as const)
        : ({
            kind: "subagent",
            subagentKind: "other",
            parentThreadId: null,
            sessionId: null,
            depth: null,
            agentNickname: null,
            agentRole: null,
          } as const);
  if (facts.phase === "awaiting-resume") {
    return {
      ...state,
      panelThread: { kind: "awaiting-resume", threadId: "thread", fallbackTitle: null, provenance },
    };
  }
  return {
    ...state,
    panelThread: {
      kind: "active",
      thread: {
        id: "thread",
        goal: null,
        tokenUsage: null,
        lifetime:
          facts.lifetime === "persistent"
            ? { kind: "persistent" }
            : { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: null },
        provenance,
      },
    },
  };
}

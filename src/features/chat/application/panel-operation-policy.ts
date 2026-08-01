import type { ChatState } from "./state/root-reducer";

/**
 * Operations whose availability derives from the panel's current thread mode.
 *
 * This intentionally excludes connection, turn-busy, and operations aimed at a
 * different listed thread. Those are workflow concerns rather than properties
 * of the active panel thread.
 */
export type ActivePanelOperation =
  | "submit"
  | "start-side-chat"
  | "compact"
  | "fork"
  | "rollback"
  | "thread-settings"
  | "permission-settings"
  | "goal-read"
  | "goal-mutation"
  | "implement-plan";

export type ActivePanelOperationDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "resume-required" };

type ActivePanelThreadFacts =
  | { readonly phase: "empty" }
  | { readonly phase: "awaiting-resume"; readonly provenance: "interactive" | "subagent" | null }
  | {
      readonly phase: "active";
      readonly lifetime: "persistent" | "ephemeral";
      readonly canAcceptDirectInput: boolean | null;
      readonly provenance: "interactive" | "subagent" | null;
    };

const ALLOWED: ActivePanelOperationDecision = { kind: "allowed" };

export function activePanelOperationDecision(state: ChatState, operation: ActivePanelOperation): ActivePanelOperationDecision {
  return activePanelOperationDecisionForFacts(activePanelThreadFacts(state), operation);
}

function activePanelOperationDecisionForFacts(
  facts: ActivePanelThreadFacts,
  operation: ActivePanelOperation,
): ActivePanelOperationDecision {
  if (facts.phase === "awaiting-resume") {
    if (facts.provenance === "subagent") return agentThreadBlocked(operation);
    return operation === "goal-mutation" ? { kind: "resume-required" } : ALLOWED;
  }
  if (facts.phase === "empty") return ALLOWED;

  if (operation === "submit") {
    if (facts.canAcceptDirectInput !== null) return facts.canAcceptDirectInput ? ALLOWED : directInputBlocked();
    if (facts.provenance === "subagent") return agentThreadBlocked(operation);
    if (facts.lifetime === "ephemeral") return sideChatDecision(operation);
    return ALLOWED;
  }

  // Keep the stricter interpretation if a malformed or future state contains
  // both mode facts. This makes mode restrictions monotonically safe.
  if (facts.provenance === "subagent" && facts.lifetime === "ephemeral") {
    return operation === "goal-read" ? sideChatDecision(operation) : agentThreadBlocked(operation);
  }
  if (facts.provenance === "subagent") return agentThreadBlocked(operation);
  if (facts.lifetime === "ephemeral") return sideChatDecision(operation);
  return ALLOWED;
}

function activePanelThreadFacts(state: ChatState): ActivePanelThreadFacts {
  const panelThread = state.panelThread;
  if (panelThread.kind === "empty") return { phase: "empty" };
  if (panelThread.kind === "awaiting-resume") {
    return { phase: "awaiting-resume", provenance: panelThread.provenance?.kind ?? null };
  }
  return {
    phase: "active",
    lifetime: panelThread.thread.lifetime?.kind ?? "persistent",
    canAcceptDirectInput: panelThread.thread.canAcceptDirectInput,
    provenance: panelThread.thread.provenance?.kind ?? null,
  };
}

function directInputBlocked(): ActivePanelOperationDecision {
  return { kind: "blocked", message: "This thread cannot accept messages." };
}

function agentThreadBlocked(operation: ActivePanelOperation): ActivePanelOperationDecision {
  switch (operation) {
    case "submit":
      return { kind: "blocked", message: "Messages are unavailable in agent threads. Start a new chat to continue." };
    case "goal-mutation":
      return { kind: "blocked", message: "Goals are read-only in agent threads." };
    case "goal-read":
      return ALLOWED;
    case "implement-plan":
      return { kind: "blocked", message: "Plans cannot be implemented from agent threads." };
    case "compact":
      return { kind: "blocked", message: "Agent threads cannot be compacted." };
    case "fork":
      return ALLOWED;
    case "rollback":
      return { kind: "blocked", message: "Agent threads cannot be rolled back." };
    case "start-side-chat":
      return { kind: "blocked", message: "Side chats cannot be started from agent threads." };
    case "thread-settings":
    case "permission-settings":
      return { kind: "blocked", message: "Thread settings are unavailable in agent threads." };
  }
}

function sideChatDecision(operation: ActivePanelOperation): ActivePanelOperationDecision {
  switch (operation) {
    case "goal-mutation":
      return { kind: "blocked", message: "Goals are unavailable in side chats." };
    case "goal-read":
      return { kind: "blocked", message: "Goals are unavailable in side chats." };
    case "implement-plan":
      return { kind: "blocked", message: "Plans cannot be implemented from side chats." };
    case "compact":
      return ALLOWED;
    case "fork":
      return { kind: "blocked", message: "Side chats cannot be forked." };
    case "rollback":
      return { kind: "blocked", message: "Side chats cannot be rolled back." };
    case "start-side-chat":
      return { kind: "blocked", message: "Side chats cannot be started from another side chat." };
    case "permission-settings":
      return { kind: "blocked", message: "Permission changes are unavailable in side chats." };
    case "submit":
      return ALLOWED;
    case "thread-settings":
      return { kind: "blocked", message: "Thread settings are unavailable in side chats." };
  }
}

import { type ChatState, isSideChatLifetime, newConversationEphemeral } from "./state/model";

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

type ConversationMode = "regular" | "temporary" | "side-chat";

const ALLOWED: ActivePanelOperationDecision = { kind: "allowed" };

export function activePanelOperationDecision(state: ChatState, operation: ActivePanelOperation): ActivePanelOperationDecision {
  const panel = state.panelThread;
  switch (panel.kind) {
    case "awaiting-resume":
      if (panel.provenance?.kind === "subagent") return agentThreadBlocked(operation);
      return operation === "goal-mutation" ? { kind: "resume-required" } : ALLOWED;
    case "empty":
      return panel.operation
        ? { kind: "blocked", message: "Wait for conversation creation to finish." }
        : conversationModeDecision(newConversationEphemeral(state) ? "temporary" : "regular", operation);
    case "fork-draft":
      if (panel.operation) return { kind: "blocked", message: "Wait for the current fork operation to finish." };
      if (panel.draft.kind === "side-chat") {
        return operation === "compact" ? uncreatedFork("side chat") : sideChatDecision(operation);
      }
      switch (operation) {
        case "submit":
        case "fork":
        case "rollback":
        case "thread-settings":
        case "permission-settings":
        case "implement-plan":
          return ALLOWED;
        default:
          return uncreatedFork("fork");
      }
    case "active": {
      const { lifetime, canAcceptDirectInput, provenance } = panel.thread;
      const mode = isSideChatLifetime(lifetime) ? "side-chat" : lifetime?.kind === "ephemeral" ? "temporary" : "regular";
      if (operation === "submit" && canAcceptDirectInput !== null) {
        return canAcceptDirectInput ? ALLOWED : directInputBlocked();
      }
      if (provenance?.kind === "subagent") {
        if (mode === "side-chat" && operation !== "goal-read") return agentThreadBlocked(operation);
        const decision = agentThreadBlocked(operation);
        if (decision.kind !== "allowed") return decision;
      }
      return conversationModeDecision(mode, operation);
    }
  }
}

function conversationModeDecision(mode: ConversationMode, operation: ActivePanelOperation): ActivePanelOperationDecision {
  if (mode === "side-chat") return sideChatDecision(operation);
  if (mode === "regular") return ALLOWED;
  switch (operation) {
    case "goal-read":
    case "goal-mutation":
    case "fork":
    case "rollback":
    case "start-side-chat":
      return { kind: "blocked", message: "This action requires a saved conversation. Start a regular chat to use it." };
    default:
      return ALLOWED;
  }
}

function uncreatedFork(kind: "fork" | "side chat"): ActivePanelOperationDecision {
  return { kind: "blocked", message: `Send a message to create this ${kind} before using this action.` };
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
    case "goal-read":
      return { kind: "blocked", message: "Goals are unavailable in side chats." };
    case "fork":
      return { kind: "blocked", message: "Side chats cannot be forked." };
    case "rollback":
      return { kind: "blocked", message: "Side chats cannot be rolled back." };
    case "start-side-chat":
      return { kind: "blocked", message: "Side chats cannot be started from another side chat." };
    case "permission-settings":
    case "submit":
    case "thread-settings":
    case "implement-plan":
    case "compact":
      return ALLOWED;
  }
}

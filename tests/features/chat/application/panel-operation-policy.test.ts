import { describe, expect, it } from "vitest";
import { type ActivePanelOperation, activePanelOperationDecision } from "../../../../src/features/chat/application/panel-operation-policy";
import { type ChatActiveThreadState, type ChatState, createChatState } from "../../../../src/features/chat/application/state/model";
import { chatStateFixture } from "../support/state";

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
const temporaryControls: readonly ActivePanelOperation[] = [
  "submit",
  "compact",
  "thread-settings",
  "permission-settings",
  "implement-plan",
];
const agent: ChatActiveThreadState["provenance"] = {
  kind: "subagent",
  subagentKind: "other",
  parentThreadId: null,
  sessionId: null,
  depth: null,
  agentNickname: null,
  agentRole: null,
};
const sideChat: ChatActiveThreadState["lifetime"] = {
  kind: "ephemeral",
  mode: "side-chat",
  sourceThreadId: "source",
  sourceThreadTitle: null,
};

const activeCases: { name: string; patch: Partial<ChatActiveThreadState>; allowed: readonly ActivePanelOperation[] }[] = [
  { name: "interactive persistent conversation", patch: {}, allowed: operations },
  { name: "ordinary temporary conversation", patch: { lifetime: { kind: "ephemeral", mode: "ordinary" } }, allowed: temporaryControls },
  { name: "side chat", patch: { lifetime: sideChat }, allowed: temporaryControls },
  {
    name: "ordinary temporary agent without input capability",
    patch: { lifetime: { kind: "ephemeral", mode: "ordinary" }, provenance: agent },
    allowed: [],
  },
  {
    name: "ordinary temporary agent with input capability",
    patch: { lifetime: { kind: "ephemeral", mode: "ordinary" }, provenance: agent, canAcceptDirectInput: true },
    allowed: ["submit"],
  },
  { name: "agent without a server capability", patch: { provenance: agent }, allowed: ["fork", "goal-read"] },
  {
    name: "agent with direct input enabled",
    patch: { provenance: agent, canAcceptDirectInput: true },
    allowed: ["submit", "fork", "goal-read"],
  },
  { name: "agent with direct input disabled", patch: { provenance: agent, canAcceptDirectInput: false }, allowed: ["fork", "goal-read"] },
  { name: "side chat carrying agent provenance", patch: { lifetime: sideChat, provenance: agent }, allowed: ["fork"] },
  {
    name: "interactive conversation with direct input disabled",
    patch: { canAcceptDirectInput: false },
    allowed: operations.filter((operation) => operation !== "submit"),
  },
];

describe("active panel operation policy", () => {
  it.each(activeCases)("applies mode and capability precedence for $name", ({ patch, allowed }) => {
    const state = chatStateFixture({
      activeThread: {
        id: "thread",
        lifetime: { kind: "persistent" },
        canAcceptDirectInput: null,
        provenance: { kind: "interactive" },
        ...patch,
      },
    });
    expectAllowedOperations(state, allowed);
  });

  it.each([false, true])("uses the uncreated conversation choice (temporary=%s)", (ephemeral) => {
    const state = { ...createChatState(), newConversationEphemeralDefault: ephemeral };
    expectAllowedOperations(state, ephemeral ? temporaryControls : operations);
  });

  it("blocks conflicting operations during creation", () => {
    const state: ChatState = { ...createChatState(), panelThread: { kind: "empty", ephemeral: true, operation: "creating" } };
    expectAllowedOperations(state, []);
  });

  it.each([
    { provenance: { kind: "interactive" } as const, decision: { kind: "resume-required" } },
    { provenance: agent, decision: { kind: "blocked", message: "Goals are read-only in agent threads." } },
  ])("checks provenance before restoring a goal mutation ($provenance.kind)", ({ provenance, decision }) => {
    const state: ChatState = {
      ...createChatState(),
      panelThread: { kind: "awaiting-resume", threadId: "thread", fallbackTitle: null, provenance },
    };
    expect(activePanelOperationDecision(state, "goal-mutation")).toEqual(decision);
  });
});

function expectAllowedOperations(state: ChatState, allowed: readonly ActivePanelOperation[]): void {
  for (const operation of operations) {
    expect(activePanelOperationDecision(state, operation).kind, operation).toBe(allowed.includes(operation) ? "allowed" : "blocked");
  }
}

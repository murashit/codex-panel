import {
  activeThreadState,
  type ChatActiveThreadState,
  type ChatState,
  createChatState,
} from "../../../../src/features/chat/application/state/model";
import type { ChatActiveTurnState } from "../../../../src/features/chat/application/state/turn-scope";

interface RuntimePatch {
  active?: Partial<ChatState["runtime"]["active"]>;
  pending?: Partial<ChatState["runtime"]["pending"]>;
}

interface ChatStateFixturePatch {
  connection?: Partial<ChatState["connection"]>;
  activeThread?: Partial<Omit<ChatActiveThreadState, "id">> & { id?: string | null };
  runtime?: RuntimePatch;
  activeTurn?: Partial<ChatActiveTurnState>;
  threadStream?: Partial<ChatState["threadStream"]>;
  requests?: Partial<ChatState["requests"]>;
  composer?: Partial<ChatState["composer"]>;
  ui?: Partial<Omit<ChatState["ui"], "disclosures">> & {
    disclosures?: Partial<ChatState["ui"]["disclosures"]>;
  };
}

export function chatStateFixture(patch: ChatStateFixturePatch = {}): ChatState {
  return chatStateWith(createChatState(), patch);
}

export function chatStateWith(state: ChatState, patch: ChatStateFixturePatch): ChatState {
  const uiPatch = patch.ui;
  const { disclosures: disclosurePatch, ...uiFieldsPatch } = uiPatch ?? {};
  return {
    ...state,
    ...(patch.connection ? { connection: { ...state.connection, ...patch.connection } } : {}),
    ...(patch.activeThread ? { panelThread: panelThreadWithPatch(state, patch.activeThread) } : {}),
    ...(patch.runtime ? { runtime: runtimeWithPatch(state.runtime, patch.runtime) } : {}),
    ...(patch.activeTurn ? { activeTurn: { ...state.activeTurn, ...patch.activeTurn } } : {}),
    ...(patch.threadStream ? { threadStream: { ...state.threadStream, ...patch.threadStream } } : {}),
    ...(patch.requests ? { requests: { ...state.requests, ...patch.requests } } : {}),
    ...(patch.composer ? { composer: { ...state.composer, ...patch.composer } } : {}),
    ...(uiPatch
      ? {
          ui: {
            ...state.ui,
            ...uiFieldsPatch,
            ...(disclosurePatch ? { disclosures: { ...state.ui.disclosures, ...disclosurePatch } } : {}),
          },
        }
      : {}),
  };
}

function panelThreadWithPatch(state: ChatState, patch: NonNullable<ChatStateFixturePatch["activeThread"]>): ChatState["panelThread"] {
  if (patch.id === null) {
    return { kind: "empty" };
  }
  const current = activeThreadState(state);
  const id = patch.id ?? current?.id;
  if (!id) throw new Error("An active thread fixture patch requires a thread id.");
  return {
    kind: "active",
    thread: {
      id,
      title: patch.title === undefined ? (current?.title ?? null) : patch.title,
      goal: patch.goal === undefined ? (current?.goal ?? null) : patch.goal,
      tokenUsage: patch.tokenUsage === undefined ? (current?.tokenUsage ?? null) : patch.tokenUsage,
      lifetime: patch.lifetime === undefined ? (current?.lifetime ?? null) : patch.lifetime,
      canAcceptDirectInput: patch.canAcceptDirectInput === undefined ? (current?.canAcceptDirectInput ?? null) : patch.canAcceptDirectInput,
      provenance: patch.provenance === undefined ? (current?.provenance ?? null) : patch.provenance,
    },
  };
}

function runtimeWithPatch(runtime: ChatState["runtime"], patch: RuntimePatch): ChatState["runtime"] {
  return {
    active: {
      ...runtime.active,
      ...(patch.active && "serviceTier" in patch.active ? { serviceTierKnown: true } : {}),
      ...(patch.active && "approvalPolicy" in patch.active ? { approvalPolicyKnown: true } : {}),
      ...(patch.active && "sandboxPolicy" in patch.active ? { sandboxPolicyKnown: true } : {}),
      ...(patch.active && "activePermissionProfile" in patch.active ? { permissionProfileKnown: true } : {}),
      ...patch.active,
    },
    pending: {
      ...runtime.pending,
      ...patch.pending,
    },
  };
}

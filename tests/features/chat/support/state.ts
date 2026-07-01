import { type ChatState, createChatState } from "../../../../src/features/chat/application/state/root-reducer";

interface RuntimePatch {
  active?: Partial<ChatState["runtime"]["active"]>;
  pending?: Partial<ChatState["runtime"]["pending"]>;
}

interface ChatStateFixturePatch {
  connection?: Partial<ChatState["connection"]>;
  threadList?: Partial<ChatState["threadList"]>;
  activeThread?: Partial<ChatState["activeThread"]>;
  runtime?: RuntimePatch;
  turn?: Partial<ChatState["turn"]>;
  messageStream?: Partial<ChatState["messageStream"]>;
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
    ...(patch.threadList ? { threadList: { ...state.threadList, ...patch.threadList } } : {}),
    ...(patch.activeThread ? { activeThread: { ...state.activeThread, ...patch.activeThread } } : {}),
    ...(patch.runtime ? { runtime: runtimeWithPatch(state.runtime, patch.runtime) } : {}),
    ...(patch.turn ? { turn: { ...state.turn, ...patch.turn } } : {}),
    ...(patch.messageStream ? { messageStream: { ...state.messageStream, ...patch.messageStream } } : {}),
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

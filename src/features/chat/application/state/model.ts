import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { Thread } from "../../../../domain/threads/model";
import type { ChatRuntimeState } from "../../domain/runtime/state";
import { initialChatRuntimeState } from "../../domain/runtime/state";
import type { ChatRequestState } from "../pending-requests/state";
import { initialChatRequestState } from "../pending-requests/state";
import type { ChatComposerState } from "./composer";
import { initialComposerState } from "./composer";
import type { ChatPendingSubmissionState } from "./pending-submission";
import type { ChatThreadStreamState } from "./thread-stream";
import { initialChatThreadStreamState } from "./thread-stream";
import type { ChatActiveTurnState } from "./turn-scope";
import { initialChatActiveTurnState } from "./turn-scope";
import type { ChatUiState } from "./ui";
import { initialUiState } from "./ui";

export type ChatConnectionPhase =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string }
  | { kind: "disconnected"; message: string };

export interface ChatConnectionState {
  readonly phase: ChatConnectionPhase;
  readonly statusText: string;
  readonly initializeResponse: ServerInitialization | null;
}

export interface ChatActiveThreadState {
  readonly id: string;
  readonly title?: string | null;
  readonly tokenUsage: ThreadTokenUsage | null;
  readonly lifetime: ActiveThreadLifetime | null;
  readonly canAcceptDirectInput: boolean | null;
  readonly provenance: Thread["provenance"] | null;
}

export type ChatPanelThreadState =
  | { readonly kind: "empty" }
  | {
      readonly kind: "awaiting-resume";
      readonly threadId: string;
      readonly fallbackTitle: string | null;
      readonly provenance: Thread["provenance"] | null;
    }
  | { readonly kind: "active"; readonly thread: ChatActiveThreadState };

type ActiveThreadLifetime =
  | { readonly kind: "persistent" }
  | { readonly kind: "ephemeral"; readonly sourceThreadId: string; readonly sourceThreadTitle: string | null };

interface ChatStateShape {
  connection: ChatConnectionState;
  panelThread: ChatPanelThreadState;
  panelTargetRevision: number;
  runtime: ChatRuntimeState;
  activeTurn: ChatActiveTurnState;
  threadStream: ChatThreadStreamState;
  pendingSubmission: ChatPendingSubmissionState | null;
  requests: ChatRequestState;
  composer: ChatComposerState;
  ui: ChatUiState;
}

export type ChatState = DeepReadonly<ChatStateShape>;

export function createChatState(): ChatState {
  return {
    connection: initialConnectionState(),
    panelThread: initialPanelThreadState(),
    panelTargetRevision: 0,
    runtime: initialChatRuntimeState(),
    activeTurn: initialChatActiveTurnState(),
    threadStream: initialChatThreadStreamState(),
    pendingSubmission: null,
    requests: initialChatRequestState(),
    composer: initialComposerState(),
    ui: initialUiState(),
  };
}

function initialConnectionState(): ChatConnectionState {
  return {
    phase: { kind: "idle" },
    statusText: "Idle",
    initializeResponse: null,
  };
}

export function initialPanelThreadState(): ChatPanelThreadState {
  return { kind: "empty" };
}

export function createAwaitingResumeThreadState(
  threadId: string,
  fallbackTitle: string | null,
  provenance: Thread["provenance"] | null = null,
): ChatPanelThreadState {
  return {
    kind: "awaiting-resume",
    threadId,
    fallbackTitle,
    provenance,
  };
}

export function createActiveThreadState(id: string): ChatActiveThreadState {
  return {
    id,
    title: null,
    tokenUsage: null,
    lifetime: null,
    canAcceptDirectInput: null,
    provenance: null,
  };
}

export function panelThreadIdForState(panelThread: ChatPanelThreadState): string | null {
  if (panelThread.kind === "awaiting-resume") return panelThread.threadId;
  return panelThread.kind === "active" ? panelThread.thread.id : null;
}

export function panelThreadId(state: ChatState): string | null {
  return panelThreadIdForState(state.panelThread);
}

export function activeThreadId(state: ChatState): string | null {
  return activeThreadState(state)?.id ?? null;
}

export function activeThreadState(state: ChatState): DeepReadonly<ChatActiveThreadState> | null {
  return state.panelThread.kind === "active" ? state.panelThread.thread : null;
}

export function awaitingResumeThreadState(state: ChatState): Extract<ChatState["panelThread"], { kind: "awaiting-resume" }> | null {
  return state.panelThread.kind === "awaiting-resume" ? state.panelThread : null;
}

export function panelThreadProvenance(state: ChatState): ChatActiveThreadState["provenance"] {
  if (state.panelThread.kind === "active") return state.panelThread.thread.provenance;
  return state.panelThread.kind === "awaiting-resume" ? state.panelThread.provenance : null;
}

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer Key, infer Value>
    ? ReadonlyMap<DeepReadonly<Key>, DeepReadonly<Value>>
    : T extends ReadonlySet<infer Value>
      ? ReadonlySet<DeepReadonly<Value>>
      : T extends readonly (infer Value)[]
        ? readonly DeepReadonly<Value>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
          : T;

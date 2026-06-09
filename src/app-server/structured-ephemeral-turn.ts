import { AppServerClient, type AppServerClientHandlers } from "./client";
import {
  createStructuredTurnRunLifecycle,
  structuredTurnRunMatches,
  transitionStructuredTurnRunLifecycle,
} from "./structured-turn-run-lifecycle";
import { abortablePromise, throwIfAbortSignalAborted } from "../shared/lifecycle/abortable";
import type { InitializeResponse } from "../generated/app-server/InitializeResponse";
import type { RequestId } from "../generated/app-server/RequestId";
import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { ModelListResponse } from "../generated/app-server/v2/ModelListResponse";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { ThreadStartResponse } from "../generated/app-server/v2/ThreadStartResponse";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { TurnStartResponse } from "../generated/app-server/v2/TurnStartResponse";

export type StructuredTurnOutputSchema = JsonValue;

interface StructuredTurnRuntimeOverride {
  model?: string;
  effort?: ReasoningEffort;
}

type StructuredTurnProgressEvent = { type: "agent-message-delta"; delta: string } | { type: "reasoning-activity" };

interface StructuredEphemeralTurnTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

const DEFAULT_STRUCTURED_EPHEMERAL_TURN_TIMERS: StructuredEphemeralTurnTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export interface StructuredEphemeralTurnClient {
  connect(): Promise<InitializeResponse>;
  disconnect(): void;
  rejectServerRequest(requestId: RequestId, code: number, message: string): void;
  startEphemeralThread(cwd: string, serviceName: string, developerInstructions: string): Promise<ThreadStartResponse>;
  startStructuredTurn(
    threadId: string,
    cwd: string,
    text: string,
    outputSchema: JsonValue,
    model?: string,
    effort?: ReasoningEffort,
  ): Promise<TurnStartResponse>;
}

export interface StructuredEphemeralTurnRuntimeClient {
  listModels(includeHidden?: boolean): Promise<ModelListResponse>;
}

type StructuredEphemeralTurnRuntimeCapableClient = StructuredEphemeralTurnClient & StructuredEphemeralTurnRuntimeClient;

export type StructuredEphemeralTurnClientFactory = (
  codexPath: string,
  cwd: string,
  handlers: AppServerClientHandlers,
) => StructuredEphemeralTurnRuntimeCapableClient;

export interface RunStructuredEphemeralTurnOptions {
  codexPath: string;
  cwd: string;
  serviceName: string;
  developerInstructions: string;
  prompt: string;
  outputSchema: StructuredTurnOutputSchema;
  timeoutMs: number;
  unhandledServerRequestMessage: string;
  exitedMessage: string;
  timedOutMessage: string;
  abortMessage?: string;
  runtime?: StructuredTurnRuntimeOverride | undefined;
  resolveRuntime?: ((client: StructuredEphemeralTurnRuntimeClient) => Promise<StructuredTurnRuntimeOverride>) | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: (event: StructuredTurnProgressEvent) => void;
  clientFactory?: StructuredEphemeralTurnClientFactory | undefined;
  timers?: StructuredEphemeralTurnTimers | undefined;
}

export async function runStructuredEphemeralTurn(options: RunStructuredEphemeralTurnOptions): Promise<Turn> {
  throwIfAborted(options.signal, options.abortMessage);
  let state = createStructuredEphemeralTurnState();
  const timers = options.timers ?? DEFAULT_STRUCTURED_EPHEMERAL_TURN_TIMERS;
  let timeout: unknown;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = timers.setTimeout(() => {
      if (state.lifecycle.kind === "completed") return;
      state = completeStructuredEphemeralTurnState(state);
      reject(new Error(options.timedOutMessage));
    }, options.timeoutMs);

    handleNotification = (notification): void => {
      const result = transitionStructuredEphemeralTurnNotification(state, notification);
      state = result.state;
      if (result.progress) options.onProgress?.(result.progress);
      if (result.completedTurn) resolve(result.completedTurn);
    };
  });

  let client!: StructuredEphemeralTurnRuntimeCapableClient;
  const clientFactory = options.clientFactory ?? ((codexPath, cwd, handlers) => new AppServerClient(codexPath, cwd, handlers));
  client = clientFactory(options.codexPath, options.cwd, {
    onNotification: (notification) => {
      handleNotification(notification);
    },
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, options.unhandledServerRequestMessage);
    },
    onLog: () => undefined,
    onExit: () => {
      if (state.lifecycle.kind === "completed") return;
      state = completeStructuredEphemeralTurnState(state);
      rejectCompletedTurn?.(new Error(options.exitedMessage));
    },
  });

  try {
    await abortable(client.connect(), options.signal, options.abortMessage);
    const runtime = options.resolveRuntime
      ? await abortable(options.resolveRuntime(client), options.signal, options.abortMessage)
      : (options.runtime ?? {});
    const threadResponse = await abortable(
      client.startEphemeralThread(options.cwd, options.serviceName, options.developerInstructions),
      options.signal,
      options.abortMessage,
    );
    state = {
      ...state,
      lifecycle: transitionStructuredTurnRunLifecycle(state.lifecycle, { type: "thread-started", threadId: threadResponse.thread.id }),
    };
    const turnResponse = await abortable(
      client.startStructuredTurn(
        threadResponse.thread.id,
        options.cwd,
        options.prompt,
        options.outputSchema,
        runtime.model,
        runtime.effort,
      ),
      options.signal,
      options.abortMessage,
    );
    state = {
      ...state,
      lifecycle: transitionStructuredTurnRunLifecycle(state.lifecycle, {
        type: "turn-started",
        threadId: threadResponse.thread.id,
        turnId: turnResponse.turn.id,
      }),
    };
    return turnResponse.turn.status === "completed"
      ? turnWithCollectedItems(turnResponse.turn, state.completedItems)
      : await abortable(completedTurn, options.signal, options.abortMessage);
  } finally {
    state = completeStructuredEphemeralTurnState(state);
    if (timeout !== undefined) timers.clearTimeout(timeout);
    client.disconnect();
  }
}

interface StructuredEphemeralTurnState {
  lifecycle: ReturnType<typeof createStructuredTurnRunLifecycle>;
  completedItems: readonly ThreadItem[];
}

interface StructuredEphemeralTurnNotificationResult {
  state: StructuredEphemeralTurnState;
  progress?: StructuredTurnProgressEvent;
  completedTurn?: Turn;
}

function createStructuredEphemeralTurnState(): StructuredEphemeralTurnState {
  return {
    lifecycle: createStructuredTurnRunLifecycle(),
    completedItems: [],
  };
}

function transitionStructuredEphemeralTurnNotification(
  state: StructuredEphemeralTurnState,
  notification: ServerNotification,
): StructuredEphemeralTurnNotificationResult {
  if (state.lifecycle.kind === "completed") return { state };
  if (notification.method === "item/agentMessage/delta") {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state, progress: { type: "agent-message-delta", delta: notification.params.delta } };
  }
  if (
    notification.method === "item/reasoning/summaryTextDelta" ||
    notification.method === "item/reasoning/textDelta" ||
    notification.method === "item/reasoning/summaryPartAdded"
  ) {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state, progress: { type: "reasoning-activity" } };
  }
  if (notification.method === "item/completed") {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state: { ...state, completedItems: [...state.completedItems, notification.params.item] } };
  }
  if (notification.method === "turn/completed") {
    if (!structuredTurnRunMatches(state.lifecycle, notification.params.threadId, notification.params.turn.id)) return { state };
    return {
      state: completeStructuredEphemeralTurnState(state),
      completedTurn: turnWithCollectedItems(notification.params.turn, state.completedItems),
    };
  }
  return { state };
}

function completeStructuredEphemeralTurnState(state: StructuredEphemeralTurnState): StructuredEphemeralTurnState {
  return {
    ...state,
    lifecycle: transitionStructuredTurnRunLifecycle(state.lifecycle, { type: "completed" }),
  };
}

function turnWithCollectedItems(turn: Turn, completedItems: readonly ThreadItem[]): Turn {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: [...completedItems], itemsView: "full" };
}

function throwIfAborted(signal: AbortSignal | undefined, message: string | undefined): void {
  throwIfAbortSignalAborted(signal, () => structuredEphemeralTurnAbortError(message));
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, message: string | undefined): Promise<T> {
  return abortablePromise(promise, signal, () => structuredEphemeralTurnAbortError(message));
}

function structuredEphemeralTurnAbortError(message: string | undefined): Error {
  return new Error(message ?? "Structured ephemeral turn cancelled.");
}

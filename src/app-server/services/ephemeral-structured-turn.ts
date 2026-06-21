import {
  AppServerClient,
  type AppServerClientHandlers,
  type AppServerStartEphemeralThreadOptions,
  type AppServerStartStructuredTurnOptions,
} from "../connection/client";
import type { RequestId, ServerNotification } from "../connection/rpc-messages";
import type { ModelMetadataClient } from "../catalog";
import { lastAgentMessageTextFromTurnRecord, type TurnItem, type TurnRecord } from "../protocol/turn";
import { abortableOperation, throwIfSignalAborted } from "./abortable-operation";

export type StructuredTurnOutputSchema = AppServerStartStructuredTurnOptions["outputSchema"];

type StructuredTurnRuntimeOverride = NonNullable<AppServerStartStructuredTurnOptions["runtime"]>;

type StructuredTurnProgressEvent = { type: "agent-message-delta"; delta: string } | { type: "reasoning-activity" };

interface EphemeralStructuredTurnTimers {
  setTimeout(callback: () => void, delayMs: number): ReturnType<Window["setTimeout"]>;
  clearTimeout(timer: ReturnType<Window["setTimeout"]>): void;
}

const DEFAULT_EPHEMERAL_STRUCTURED_TURN_TIMERS: EphemeralStructuredTurnTimers = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    window.clearTimeout(timer);
  },
};

export interface EphemeralStructuredTurnClient {
  connect(): Promise<unknown>;
  disconnect(): void;
  rejectServerRequest(requestId: RequestId, code: number, message: string): void;
  startEphemeralThread(options: AppServerStartEphemeralThreadOptions): Promise<{ thread: { id: string } }>;
  startStructuredTurn(options: AppServerStartStructuredTurnOptions): Promise<{ turn: TurnRecord }>;
}

type EphemeralStructuredTurnRuntimeCapableClient = EphemeralStructuredTurnClient & ModelMetadataClient;

export type EphemeralStructuredTurnClientFactory = (
  codexPath: string,
  cwd: string,
  handlers: AppServerClientHandlers,
) => EphemeralStructuredTurnRuntimeCapableClient;

export interface RunEphemeralStructuredTurnOptions {
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
  resolveRuntime?: ((client: ModelMetadataClient) => Promise<StructuredTurnRuntimeOverride>) | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: (event: StructuredTurnProgressEvent) => void;
  clientFactory?: EphemeralStructuredTurnClientFactory | undefined;
  timers?: EphemeralStructuredTurnTimers | undefined;
}

export async function runEphemeralStructuredTurn(options: RunEphemeralStructuredTurnOptions): Promise<TurnRecord> {
  throwIfAborted(options.signal, options.abortMessage);
  let state = createEphemeralStructuredTurnState();
  const timers = options.timers ?? DEFAULT_EPHEMERAL_STRUCTURED_TURN_TIMERS;
  let timeout: ReturnType<Window["setTimeout"]> | undefined;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;
  let operationAbortError: Error | null = null;
  const operationAbort = new AbortController();
  const abortOperation = (error: Error): void => {
    if (operationAbort.signal.aborted) return;
    operationAbortError = error;
    operationAbort.abort();
  };
  const abortableOperation = <T>(promise: Promise<T>): Promise<T> =>
    abortable(
      abortable(promise, options.signal, () => ephemeralStructuredTurnAbortError(options.abortMessage)),
      operationAbort.signal,
      () => operationAbortError ?? ephemeralStructuredTurnAbortError(options.abortMessage),
    );

  timeout = timers.setTimeout(() => {
    if (state.lifecycle.kind === "completed") return;
    state = completeEphemeralStructuredTurnState(state);
    abortOperation(new Error(options.timedOutMessage));
  }, options.timeoutMs);

  const completedTurn = new Promise<TurnRecord>((resolve) => {
    handleNotification = (notification): void => {
      const result = transitionEphemeralStructuredTurnNotification(state, notification);
      state = result.state;
      if (result.progress) options.onProgress?.(result.progress);
      if (result.completedTurn) resolve(result.completedTurn);
    };
  });

  let client!: EphemeralStructuredTurnRuntimeCapableClient;
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
      state = completeEphemeralStructuredTurnState(state);
      abortOperation(new Error(options.exitedMessage));
    },
  });

  try {
    await abortableOperation(client.connect());
    const runtime = options.resolveRuntime ? await abortableOperation(options.resolveRuntime(client)) : (options.runtime ?? {});
    const threadResponse = await abortableOperation(
      client.startEphemeralThread({
        cwd: options.cwd,
        serviceName: options.serviceName,
        developerInstructions: options.developerInstructions,
      }),
    );
    state = {
      ...state,
      lifecycle: transitionEphemeralStructuredTurnLifecycle(state.lifecycle, {
        type: "thread-started",
        threadId: threadResponse.thread.id,
      }),
    };
    const turnResponse = await abortableOperation(
      client.startStructuredTurn({
        threadId: threadResponse.thread.id,
        cwd: options.cwd,
        text: options.prompt,
        outputSchema: options.outputSchema,
        runtime,
      }),
    );
    state = {
      ...state,
      lifecycle: transitionEphemeralStructuredTurnLifecycle(state.lifecycle, {
        type: "turn-started",
        threadId: threadResponse.thread.id,
        turnId: turnResponse.turn.id,
      }),
    };
    return turnResponse.turn.status === "completed"
      ? turnWithCollectedItems(turnResponse.turn, state.completedItems)
      : await abortableOperation(completedTurn);
  } finally {
    state = completeEphemeralStructuredTurnState(state);
    timers.clearTimeout(timeout);
    client.disconnect();
  }
}

export async function runEphemeralStructuredTurnForLastAgentText(options: RunEphemeralStructuredTurnOptions): Promise<string | null> {
  const turn = await runEphemeralStructuredTurn(options);
  return lastAgentMessageTextFromTurnRecord(turn);
}

type EphemeralStructuredTurnLifecycleState =
  | { kind: "starting" }
  | { kind: "thread-started"; threadId: string }
  | { kind: "turn-started"; threadId: string; turnId: string }
  | { kind: "completed" };

type EphemeralStructuredTurnLifecycleEvent =
  | { type: "thread-started"; threadId: string }
  | { type: "turn-started"; threadId: string; turnId: string }
  | { type: "completed" };

interface EphemeralStructuredTurnState {
  lifecycle: EphemeralStructuredTurnLifecycleState;
  completedItems: readonly TurnItem[];
}

interface EphemeralStructuredTurnNotificationResult {
  state: EphemeralStructuredTurnState;
  progress?: StructuredTurnProgressEvent;
  completedTurn?: TurnRecord;
}

function createEphemeralStructuredTurnState(): EphemeralStructuredTurnState {
  return {
    lifecycle: { kind: "starting" },
    completedItems: [],
  };
}

function transitionEphemeralStructuredTurnNotification(
  state: EphemeralStructuredTurnState,
  notification: ServerNotification,
): EphemeralStructuredTurnNotificationResult {
  if (state.lifecycle.kind === "completed") return { state };
  if (notification.method === "item/agentMessage/delta") {
    if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state, progress: { type: "agent-message-delta", delta: notification.params.delta } };
  }
  if (
    notification.method === "item/reasoning/summaryTextDelta" ||
    notification.method === "item/reasoning/textDelta" ||
    notification.method === "item/reasoning/summaryPartAdded"
  ) {
    if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state, progress: { type: "reasoning-activity" } };
  }
  if (notification.method === "item/completed") {
    if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return { state };
    return { state: { ...state, completedItems: [...state.completedItems, notification.params.item] } };
  }
  if (notification.method === "turn/completed") {
    if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turn.id)) return { state };
    return {
      state: completeEphemeralStructuredTurnState(state),
      completedTurn: turnWithCollectedItems(notification.params.turn, state.completedItems),
    };
  }
  return { state };
}

function completeEphemeralStructuredTurnState(state: EphemeralStructuredTurnState): EphemeralStructuredTurnState {
  return {
    ...state,
    lifecycle: transitionEphemeralStructuredTurnLifecycle(state.lifecycle, { type: "completed" }),
  };
}

function transitionEphemeralStructuredTurnLifecycle(
  state: EphemeralStructuredTurnLifecycleState,
  event: EphemeralStructuredTurnLifecycleEvent,
): EphemeralStructuredTurnLifecycleState {
  if (state.kind === "completed") return state;
  switch (event.type) {
    case "thread-started":
      return { kind: "thread-started", threadId: event.threadId };
    case "turn-started":
      return { kind: "turn-started", threadId: event.threadId, turnId: event.turnId };
    case "completed":
      return { kind: "completed" };
  }
}

function ephemeralStructuredTurnMatches(state: EphemeralStructuredTurnLifecycleState, threadId: string, turnId: string): boolean {
  if (state.kind === "thread-started") return state.threadId === threadId;
  if (state.kind === "turn-started") return state.threadId === threadId && state.turnId === turnId;
  return false;
}

function turnWithCollectedItems(turn: TurnRecord, completedItems: readonly TurnItem[]): TurnRecord {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: [...completedItems], itemsView: "full" };
}

function throwIfAborted(signal: AbortSignal | undefined, message: string | undefined): void {
  throwIfSignalAborted(signal, () => ephemeralStructuredTurnAbortError(message));
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, abortError: () => Error): Promise<T> {
  return abortableOperation(promise, signal, abortError);
}

function ephemeralStructuredTurnAbortError(message: string | undefined): Error {
  return new Error(message ?? "Ephemeral structured turn cancelled.");
}

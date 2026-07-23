import { AppServerClient, type AppServerClientHandlers } from "../connection/client";
import type { AppServerClientRequestPolicy } from "../connection/client-access";
import { codexPanelAppServerInitializeParams } from "../connection/client-profile";
import type { ServerNotification } from "../connection/rpc-messages";
import { lastAgentMessageTextFromTurnRecord, type TurnItem, type TurnRecord } from "../protocol/turn";
import type { ModelMetadataClient } from "./catalog";
import type { AppServerRequestClient } from "./request-client";
import { type RuntimeOverrideSettings, resolvedRuntimeOverrideForClient } from "./runtime-overrides";
import { deleteThread, startEphemeralThread } from "./threads";
import { type AppServerStartStructuredTurnOptions, startStructuredTurn } from "./turns";

export type StructuredTurnOutputSchema = AppServerStartStructuredTurnOptions["outputSchema"];

type StructuredTurnRuntimeOverride = NonNullable<AppServerStartStructuredTurnOptions["runtime"]>;

type StructuredTurnProgressEvent = { type: "agent-message-delta"; delta: string } | { type: "reasoning-activity" };

const EPHEMERAL_THREAD_CLEANUP_TIMEOUT_MS = 5_000;

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
  request: AppServerRequestClient["request"];
  connect(): Promise<unknown>;
  disconnect(): void;
}

type EphemeralStructuredTurnRuntimeCapableClient = EphemeralStructuredTurnClient & ModelMetadataClient;

type EphemeralStructuredTurnClientFactory = (
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
  serverRequests: Extract<AppServerClientRequestPolicy, { kind: "reject" }>;
  exitedMessage: string;
  timedOutMessage: string;
  abortMessage?: string;
  runtime?: StructuredTurnRuntimeOverride | undefined;
  runtimeSettings?: RuntimeOverrideSettings | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: (event: StructuredTurnProgressEvent) => void;
}

export type EphemeralStructuredTurnRunner = (options: RunEphemeralStructuredTurnOptions) => Promise<TurnRecord>;

export interface EphemeralStructuredTurnDependencies {
  clientFactory?: EphemeralStructuredTurnClientFactory | undefined;
  timers?: EphemeralStructuredTurnTimers | undefined;
  clientLifecycle?:
    | {
        created(client: EphemeralStructuredTurnClient): void;
        disposed(client: EphemeralStructuredTurnClient): void;
      }
    | undefined;
}

export async function runEphemeralStructuredTurn(
  options: RunEphemeralStructuredTurnOptions,
  dependencies: EphemeralStructuredTurnDependencies = {},
): Promise<TurnRecord> {
  throwIfAborted(options.signal, options.abortMessage);
  let state = createEphemeralStructuredTurnState();
  const timers = dependencies.timers ?? DEFAULT_EPHEMERAL_STRUCTURED_TURN_TIMERS;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;
  let operationAbortError: Error | null = null;
  const operationAbort = new AbortController();
  const abortOperation = (error: Error): void => {
    if (operationAbort.signal.aborted) return;
    operationAbortError = error;
    operationAbort.abort();
  };
  const runAbortable = <T>(promise: Promise<T>): Promise<T> =>
    rejectOnAbort(
      rejectOnAbort(promise, options.signal, () => ephemeralStructuredTurnAbortError(options.abortMessage)),
      operationAbort.signal,
      () => operationAbortError ?? ephemeralStructuredTurnAbortError(options.abortMessage),
    );

  const timeout = timers.setTimeout(() => {
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

  const clientFactory =
    dependencies.clientFactory ??
    ((codexPath, cwd, handlers) =>
      new AppServerClient({
        codexPath,
        cwd,
        handlers,
        initializeParams: codexPanelAppServerInitializeParams(),
      }));
  let threadId: string | null = null;
  const client = clientFactory(options.codexPath, options.cwd, {
    onNotification: (notification) => {
      handleNotification(notification);
    },
    onServerRequest: (request, responder) => {
      void request;
      responder.reject(-32601, options.serverRequests.message);
    },
    onLog: () => undefined,
    onExit: () => {
      if (state.lifecycle.kind === "completed") return;
      state = completeEphemeralStructuredTurnState(state);
      abortOperation(new Error(options.exitedMessage));
    },
  });
  dependencies.clientLifecycle?.created(client);

  try {
    await runAbortable(client.connect());
    const runtime = options.runtimeSettings
      ? await runAbortable(resolvedRuntimeOverrideForClient(client, options.runtimeSettings))
      : (options.runtime ?? {});
    const threadResponse = await runAbortable(
      startEphemeralThread(client, {
        cwd: options.cwd,
        serviceName: options.serviceName,
        developerInstructions: options.developerInstructions,
      }),
    );
    threadId = threadResponse.thread.id;
    state = {
      ...state,
      lifecycle: transitionEphemeralStructuredTurnLifecycle(state.lifecycle, {
        type: "thread-started",
        threadId,
      }),
    };
    const turnResponse = await runAbortable(
      startStructuredTurn(client, {
        threadId,
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
        threadId,
        turnId: turnResponse.turn.id,
      }),
    };
    return turnResponse.turn.status === "completed"
      ? turnWithCollectedItems(turnResponse.turn, state.completedItems)
      : await runAbortable(completedTurn);
  } finally {
    state = completeEphemeralStructuredTurnState(state);
    timers.clearTimeout(timeout);
    try {
      await deleteEphemeralStructuredTurnThread(client, threadId);
    } finally {
      client.disconnect();
      dependencies.clientLifecycle?.disposed(client);
    }
  }
}

export async function runEphemeralStructuredTurnForLastAgentText(
  options: RunEphemeralStructuredTurnOptions,
  runner: EphemeralStructuredTurnRunner = runEphemeralStructuredTurn,
): Promise<string | null> {
  const turn = await runner(options);
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

async function deleteEphemeralStructuredTurnThread(client: EphemeralStructuredTurnClient, threadId: string | null): Promise<void> {
  if (!threadId) return;
  try {
    await deleteThread(client, threadId, { timeoutMs: EPHEMERAL_THREAD_CLEANUP_TIMEOUT_MS });
  } catch {
    // Ephemeral helpers must not fail visible workflows because cleanup raced app-server shutdown.
  }
}

function throwIfAborted(signal: AbortSignal | undefined, message: string | undefined): void {
  if (signal?.aborted) throw ephemeralStructuredTurnAbortError(message);
}

function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, abortError: () => Error): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function ephemeralStructuredTurnAbortError(message: string | undefined): Error {
  return new Error(message ?? "Ephemeral structured turn cancelled.");
}

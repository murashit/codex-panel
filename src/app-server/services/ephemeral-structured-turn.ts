import { isObjectValue } from "../../domain/objects/object-value";
import { AppServerClient, type AppServerClientHandlers } from "../connection/client";
import { codexPanelAppServerInitializeParams } from "../connection/client-profile";
import type { ServerNotification } from "../connection/rpc-messages";
import { lastAgentMessageTextFromTurnRecord, type TurnItem, type TurnRecord } from "../protocol/turn";
import type { AppServerRequestClient } from "./request-client";
import { type RuntimeOverrideSettings, validatedRuntimeOverrideForClient } from "./runtime-overrides";
import { startEphemeralThread } from "./threads";
import { type AppServerStartStructuredTurnOptions, startStructuredTurn } from "./turns";

export type StructuredTurnOutputSchema = AppServerStartStructuredTurnOptions["outputSchema"];

type StructuredTurnProgressEvent = { type: "agent-message-delta"; delta: string } | { type: "reasoning-activity" };

export interface EphemeralStructuredTurnClient {
  request: AppServerRequestClient["request"];
  connect(): Promise<unknown>;
  disconnect(): void;
}

type EphemeralStructuredTurnClientFactory = (
  codexPath: string,
  cwd: string,
  handlers: AppServerClientHandlers,
) => EphemeralStructuredTurnClient;

export interface RunEphemeralStructuredTurnOptions {
  codexPath: string;
  cwd: string;
  serviceName: string;
  developerInstructions: string;
  prompt: string;
  outputSchema: StructuredTurnOutputSchema;
  timeoutMs: number;
  serverRequestRejectionMessage: string;
  exitedMessage: string;
  timedOutMessage: string;
  abortMessage?: string;
  runtimeSettings: RuntimeOverrideSettings;
  signal?: AbortSignal | undefined;
  onProgress?: (event: StructuredTurnProgressEvent) => void;
}

export type EphemeralStructuredTurnRunner = (options: RunEphemeralStructuredTurnOptions) => Promise<TurnRecord>;

export async function runEphemeralStructuredTurn(
  options: RunEphemeralStructuredTurnOptions,
  clientFactory: EphemeralStructuredTurnClientFactory = (codexPath, cwd, handlers) =>
    new AppServerClient({ codexPath, cwd, handlers, initializeParams: codexPanelAppServerInitializeParams() }),
): Promise<TurnRecord> {
  if (options.signal?.aborted) throw ephemeralStructuredTurnAbortError(options.abortMessage);
  const state: EphemeralStructuredTurnState = { lifecycle: { kind: "starting" }, completedItems: [] };
  let handleNotification!: (notification: ServerNotification) => void;
  let interrupt!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject;
  });
  const runAbortable = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, interrupted]);
  const cancel = (): void => {
    interrupt(ephemeralStructuredTurnAbortError(options.abortMessage));
  };

  const completedTurn = new Promise<TurnRecord>((resolve) => {
    handleNotification = (notification): void => {
      if (state.lifecycle.kind === "completed") return;
      switch (notification.method) {
        case "item/agentMessage/delta":
          if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return;
          options.onProgress?.({ type: "agent-message-delta", delta: notification.params.delta });
          return;
        case "item/reasoning/summaryTextDelta":
        case "item/reasoning/textDelta":
        case "item/reasoning/summaryPartAdded":
          if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return;
          options.onProgress?.({ type: "reasoning-activity" });
          return;
        case "item/completed":
          if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turnId)) return;
          state.completedItems.push(notification.params.item);
          return;
        case "turn/completed":
          if (!ephemeralStructuredTurnMatches(state.lifecycle, notification.params.threadId, notification.params.turn.id)) return;
          state.lifecycle = { kind: "completed" };
          resolve(turnWithCollectedItems(notification.params.turn, state.completedItems));
      }
    };
  });

  const client = clientFactory(options.codexPath, options.cwd, {
    onNotification: handleNotification,
    onServerRequest: (_request, responder) => {
      responder.reject(-32601, options.serverRequestRejectionMessage);
    },
    onLog: () => undefined,
    onExit: () => {
      if (state.lifecycle.kind === "completed") return;
      state.lifecycle = { kind: "completed" };
      interrupt(new Error(options.exitedMessage));
    },
  });

  const timeout = window.setTimeout(() => {
    state.lifecycle = { kind: "completed" };
    interrupt(new Error(options.timedOutMessage));
  }, options.timeoutMs);

  try {
    options.signal?.addEventListener("abort", cancel, { once: true });
    await runAbortable(client.connect());
    const runtime = await runAbortable(validatedRuntimeOverrideForClient(client, options.runtimeSettings));
    const threadResponse = await runAbortable(
      startEphemeralThread(client, {
        cwd: options.cwd,
        serviceName: options.serviceName,
        developerInstructions: options.developerInstructions,
      }),
    );
    const threadId = threadResponse.thread.id;
    if (state.lifecycle.kind !== "completed") state.lifecycle = { kind: "thread-started", threadId };
    const turnResponse = await runAbortable(
      startStructuredTurn(client, {
        threadId,
        cwd: options.cwd,
        text: options.prompt,
        outputSchema: options.outputSchema,
        runtime,
      }),
    );
    if (state.lifecycle.kind !== "completed") {
      state.lifecycle = { kind: "turn-started", threadId, turnId: turnResponse.turn.id };
    }
    return turnResponse.turn.status === "completed"
      ? turnWithCollectedItems(turnResponse.turn, state.completedItems)
      : await runAbortable(completedTurn);
  } finally {
    state.lifecycle = { kind: "completed" };
    options.signal?.removeEventListener("abort", cancel);
    window.clearTimeout(timeout);
    // Ephemeral threads are not persisted; thread/delete rejects them. Stop their private process instead.
    client.disconnect();
  }
}

export function structuredTurnStringField(text: string | null, field: string): string | null {
  if (!text) return null;
  try {
    const result: unknown = JSON.parse(text);
    return isObjectValue(result) && typeof result[field] === "string" ? result[field] : null;
  } catch {
    return null;
  }
}

export async function runEphemeralStructuredTurnForLastAgentText(
  options: RunEphemeralStructuredTurnOptions,
  runner: EphemeralStructuredTurnRunner,
): Promise<string | null> {
  const turn = await runner(options);
  return lastAgentMessageTextFromTurnRecord(turn);
}

type EphemeralStructuredTurnLifecycleState =
  | { kind: "starting" }
  | { kind: "thread-started"; threadId: string }
  | { kind: "turn-started"; threadId: string; turnId: string }
  | { kind: "completed" };

interface EphemeralStructuredTurnState {
  lifecycle: EphemeralStructuredTurnLifecycleState;
  completedItems: TurnItem[];
}

function ephemeralStructuredTurnMatches(state: EphemeralStructuredTurnLifecycleState, threadId: string, turnId: string): boolean {
  if (state.kind === "thread-started") return state.threadId === threadId;
  return state.kind === "turn-started" && state.threadId === threadId && state.turnId === turnId;
}

function turnWithCollectedItems(turn: TurnRecord, completedItems: readonly TurnItem[]): TurnRecord {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: [...completedItems], itemsView: "full" };
}

function ephemeralStructuredTurnAbortError(message: string | undefined): Error {
  return new Error(message ?? "Ephemeral structured turn cancelled.");
}

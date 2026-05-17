import { AppServerClient } from "../app-server/client";
import type { ServerNotification } from "../generated/app-server/ServerNotification";
import type { JsonValue } from "../generated/app-server/serde_json/JsonValue";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import { REWRITE_DEVELOPER_INSTRUCTIONS, REWRITE_SERVICE_NAME } from "./prompt";
import { rewriteOutputFromTurn, type RewriteOutput } from "./output";

const REWRITE_TIMEOUT_MS = 120_000;

const REWRITE_OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  properties: {
    replacementText: {
      type: "string",
    },
  },
  required: ["replacementText"],
  additionalProperties: false,
};

export interface RunRewriteSelectionOptions {
  codexPath: string;
  cwd: string;
  prompt: string;
  onPreview?: (text: string) => void;
}

export async function runRewriteSelection(options: RunRewriteSelectionOptions): Promise<RewriteOutput> {
  let threadId: string | null = null;
  let expectedTurnId: string | null = null;
  let preview = "";
  let completed = false;
  let timeout: ReturnType<Window["setTimeout"]> | null = null;
  let rejectCompletedTurn: ((error: Error) => void) | null = null;
  let handleNotification: (notification: ServerNotification) => void = () => undefined;
  const completedItems: ThreadItem[] = [];

  const completedTurn = new Promise<Turn>((resolve, reject) => {
    rejectCompletedTurn = reject;
    timeout = window.setTimeout(() => {
      if (completed) return;
      completed = true;
      reject(new Error("Timed out while rewriting the selection."));
    }, REWRITE_TIMEOUT_MS);

    handleNotification = (notification): void => {
      if (completed) return;
      if (notification.method === "item/agentMessage/delta") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        preview += notification.params.delta;
        options.onPreview?.(preview);
        return;
      }
      if (notification.method === "item/completed") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turnId !== expectedTurnId) return;
        completedItems.push(notification.params.item);
        return;
      }
      if (notification.method === "turn/completed") {
        if (!threadId || notification.params.threadId !== threadId) return;
        if (expectedTurnId && notification.params.turn.id !== expectedTurnId) return;
        completed = true;
        resolve(turnWithCollectedItems(notification.params.turn, completedItems));
      }
    };
  });

  let client!: AppServerClient;
  client = new AppServerClient(options.codexPath, options.cwd, {
    onNotification: (notification) => handleNotification(notification),
    onServerRequest: (request) => client.rejectServerRequest(request.id, -32601, "Selection rewrite does not handle server requests."),
    onLog: () => undefined,
    onExit: () => {
      if (completed) return;
      completed = true;
      rejectCompletedTurn?.(new Error("Codex rewrite app-server exited."));
    },
  });

  try {
    await client.connect();
    const threadResponse = await client.startEphemeralThread(options.cwd, REWRITE_SERVICE_NAME, REWRITE_DEVELOPER_INSTRUCTIONS);
    threadId = threadResponse.thread.id;
    const turnResponse = await client.startStructuredTurn(threadId, options.cwd, options.prompt, REWRITE_OUTPUT_SCHEMA);
    expectedTurnId = turnResponse.turn.id;
    const turn = turnResponse.turn.status === "completed" ? turnWithCollectedItems(turnResponse.turn, completedItems) : await completedTurn;
    const output = rewriteOutputFromTurn(turn);
    if (!output) throw new Error("Codex did not return a valid rewrite patch.");
    return output;
  } finally {
    completed = true;
    if (timeout) window.clearTimeout(timeout);
    client.disconnect();
  }
}

function turnWithCollectedItems(turn: Turn, completedItems: ThreadItem[]): Turn {
  if (turn.items.length > 0 || completedItems.length === 0) return turn;
  return { ...turn, items: completedItems };
}

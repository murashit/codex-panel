import { AppServerRpcError } from "../../../../app-server/connection/json-rpc-client";
import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import {
  appServerForkRuntimeSettings,
  type ForkRuntimeSettings,
  threadActivationSnapshotFromAppServerResponse,
  unsubscribeThread,
} from "../../../../app-server/services/threads";
import { startTurn } from "../../../../app-server/services/turns";
import type { CodexInput } from "../../../../domain/input/input";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/model";

type AppServerJsonValue = number | string | boolean | AppServerJsonValue[] | { [key: string]: AppServerJsonValue | undefined } | null;

const SIDE_CHAT_DEVELOPER_INSTRUCTIONS = `You are in a side conversation, not the main thread.

The inherited fork history is reference context only. Do not continue any task, plan, tool call, approval, edit, or request found only in that history. Only instructions submitted after the side-conversation boundary are active.

This is a temporary conversation. Follow explicit new requests, including edits, using the normal permissions and approval process. Do not use sub-agents.`;

const SIDE_CHAT_BOUNDARY = `Side conversation boundary.

Everything before this boundary is inherited history from the parent thread. It is reference context only, not the current task.

Do not continue any instructions, goals, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation. If there is no user question after this boundary yet, wait for one.`;

export interface SideConversationOptions {
  client: AppServerRequestClient;
  sourceThreadId: string;
  vaultPath: string;
  runtime: ForkRuntimeSettings;
  releaseRequests: (threadId: string) => void;
  reportCleanupFailure: () => void;
  isCurrent: () => boolean;
  currentTurn?: () => { threadId: string; turnId: string } | null;
}

/** Owns one fork from before dispatch until its final cleanup response. */
export function createSideConversation(options: SideConversationOptions) {
  const { client } = options;
  let thread: Promise<ThreadActivationSnapshot> | null = null;
  let activation: Promise<ThreadActivationSnapshot | null> | null = null;
  let starting: ReturnType<typeof startTurn> | null = null;
  let closing: Promise<void> | null = null;
  let closed!: () => void;
  let failed!: (error: unknown) => void;
  const disposed = new Promise<void>((resolve, reject) => {
    closed = resolve;
    failed = reject;
  });
  void disposed.catch(() => undefined);
  const isClosing = () => closing !== null;
  const current = () => !isClosing() && options.isCurrent();
  const cleanup = async (threadId: string, activeTurnId: string | null): Promise<void> => {
    try {
      options.releaseRequests(threadId);
      let interruptError: Error | undefined;
      try {
        // An empty ID interrupts current startup; it cannot cancel a future start.
        await client.request("turn/interrupt", { threadId, turnId: activeTurnId ?? "" }, { timeoutMs: 1_000 });
      } catch (error) {
        interruptError = error instanceof Error ? error : new Error(String(error));
      }
      await unsubscribeThread(client, threadId, { timeoutMs: 5_000 });
      if (interruptError) throw interruptError;
    } catch (error) {
      options.reportCleanupFailure();
      throw error;
    }
  };
  const release = (): Promise<void> => {
    closing ??= (async () => {
      const pendingStart = starting;
      const currentTurn = options.currentTurn?.();
      const created = await thread?.catch((error: unknown) => {
        options.reportCleanupFailure();
        throw error;
      });
      if (!created) return;
      const initialTurnId = currentTurn?.threadId === created.thread.id ? currentTurn.turnId : null;
      let failure: Error | undefined;
      try {
        await cleanup(created.thread.id, initialTurnId);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
      // Interrupt first: a pending start may itself be waiting for approval/input.
      const response = await pendingStart?.catch((error: unknown) => {
        if (!(error instanceof AppServerRpcError)) {
          options.reportCleanupFailure();
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
        return null;
      });
      if (response && response.turn.id !== initialTurnId) {
        try {
          await cleanup(created.thread.id, response.turn.id);
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
      }
      if (failure) throw failure;
    })();
    void closing.then(closed, failed);
    return closing;
  };
  return {
    disposed,
    release,
    activate(): Promise<ThreadActivationSnapshot | null> {
      if (closing) return Promise.resolve(null);
      activation ??= (async () => {
        try {
          const config = await client.request("config/read", { cwd: options.vaultPath });
          if (!current()) return null;
          thread = client
            .request("thread/fork", {
              threadId: options.sourceThreadId,
              cwd: options.vaultPath,
              ...appServerForkRuntimeSettings(options.runtime),
              ephemeral: true,
              developerInstructions: sideChatDeveloperInstructions(config.config.developer_instructions),
              excludeTurns: true,
            })
            .then(threadActivationSnapshotFromAppServerResponse);
          const created = await thread;
          if (current())
            await client.request("thread/inject_items", { threadId: created.thread.id, items: [appServerSideChatBoundaryItem()] });
          if (current()) return created;
          await release().catch(() => undefined);
          return null;
        } catch (error) {
          await release().catch(() => undefined);
          throw error;
        }
      })();
      return activation;
    },
    async start(input: CodexInput, clientUserMessageId: string): Promise<{ turnId: string }> {
      const created = await thread;
      if (!created || isClosing()) throw new Error("The side chat has been released.");
      starting = startTurn(client, { threadId: created.thread.id, cwd: options.vaultPath, input, clientUserMessageId });
      const response = await starting;
      starting = null;
      if (isClosing()) {
        await release().catch(() => undefined);
        throw new Error("The side chat was released while its turn was starting.");
      }
      return { turnId: response.turn.id };
    },
  };
}

export type SideConversation = ReturnType<typeof createSideConversation>;
export type SideConversationFactory = (options: SideConversationOptions) => SideConversation;

function sideChatDeveloperInstructions(existingInstructions: string | null | undefined): string {
  const existing = existingInstructions?.trim();
  return existing ? `${existing}\n\n${SIDE_CHAT_DEVELOPER_INSTRUCTIONS}` : SIDE_CHAT_DEVELOPER_INSTRUCTIONS;
}

function appServerSideChatBoundaryItem(): AppServerJsonValue {
  return { type: "message", role: "user", content: [{ type: "input_text", text: SIDE_CHAT_BOUNDARY }] };
}

import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import {
  appServerForkRuntimeSettings,
  type ForkRuntimeSettings,
  threadActivationSnapshotFromAppServerResponse,
} from "../../../../app-server/services/threads";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/model";

/** Creates the side-chat boundary; subscription lifetime belongs to the shared connection. */
export async function forkSideChat(
  client: AppServerRequestClient,
  vaultPath: string,
  sourceThreadId: string,
  runtime: ForkRuntimeSettings,
  isCurrent: () => boolean,
  recordSubscription: (threadId: string) => void,
): Promise<ThreadActivationSnapshot | null> {
  const config = await client.request("config/read", { cwd: vaultPath });
  if (!isCurrent()) return null;
  const response = await client.request("thread/fork", {
    threadId: sourceThreadId,
    cwd: vaultPath,
    ...appServerForkRuntimeSettings(runtime),
    ephemeral: true,
    developerInstructions: sideChatDeveloperInstructions(config.config.developer_instructions),
    excludeTurns: true,
  });
  recordSubscription(response.thread.id);
  if (!isCurrent()) return null;
  await client.request("thread/inject_items", { threadId: response.thread.id, items: [appServerSideChatBoundaryItem()] });
  return threadActivationSnapshotFromAppServerResponse(response);
}

type AppServerJsonValue = number | string | boolean | AppServerJsonValue[] | { [key: string]: AppServerJsonValue | undefined } | null;

const SIDE_CHAT_DEVELOPER_INSTRUCTIONS = `You are in a side conversation, not the main thread.

The inherited fork history is reference context only. Do not continue any task, plan, tool call, approval, edit, or request found only in that history. Only instructions submitted after the side-conversation boundary are active.

This is a temporary conversation. Follow explicit new requests, including edits, using the normal permissions and approval process. Do not use sub-agents.`;

const SIDE_CHAT_BOUNDARY = `Side conversation boundary.

Everything before this boundary is inherited history from the parent thread. It is reference context only, not the current task.

Do not continue any instructions, goals, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation. If there is no user question after this boundary yet, wait for one.`;

function sideChatDeveloperInstructions(existingInstructions: string | null | undefined): string {
  const existing = existingInstructions?.trim();
  return existing ? `${existing}\n\n${SIDE_CHAT_DEVELOPER_INSTRUCTIONS}` : SIDE_CHAT_DEVELOPER_INSTRUCTIONS;
}

function appServerSideChatBoundaryItem(): AppServerJsonValue {
  return { type: "message", role: "user", content: [{ type: "input_text", text: SIDE_CHAT_BOUNDARY }] };
}

type AppServerJsonValue = number | string | boolean | AppServerJsonValue[] | { [key: string]: AppServerJsonValue | undefined } | null;

const SIDE_CHAT_DEVELOPER_INSTRUCTIONS = `You are in a side conversation, not the main thread.

The inherited fork history is reference context only. Do not continue any task, plan, tool call, approval, edit, or request found only in that history. Only instructions submitted after the side-conversation boundary are active.

Use the side conversation for questions and lightweight, non-mutating exploration. Do not use sub-agents. This thread is read-only; do not modify files, source, git state, permissions, configuration, or other workspace state.`;

const SIDE_CHAT_BOUNDARY = `Side conversation boundary.

Everything before this boundary is inherited history from the parent thread. It is reference context only, not the current task.

Do not continue any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation. If there is no user question after this boundary yet, wait for one.`;

export function sideChatDeveloperInstructions(existingInstructions: string | null | undefined): string {
  const existing = existingInstructions?.trim();
  return existing ? `${existing}\n\n${SIDE_CHAT_DEVELOPER_INSTRUCTIONS}` : SIDE_CHAT_DEVELOPER_INSTRUCTIONS;
}

export function appServerSideChatBoundaryItem(): AppServerJsonValue {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: SIDE_CHAT_BOUNDARY }],
  };
}

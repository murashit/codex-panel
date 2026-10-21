import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";

type AgentItem = Extract<ThreadStreamItem, { kind: "agent" }>;
type CommandItem = Extract<ThreadStreamItem, { kind: "command" }>;

export function agentItemFixture(overrides: Partial<AgentItem>): AgentItem {
  return {
    id: "agent-1",
    kind: "agent",
    role: "tool",
    coordinationUpdate: "snapshot",
    turnId: "turn",
    text: "Spawn agent",
    action: "spawn",
    status: "completed",
    senderThreadId: "parent",
    targets: [],
    prompt: null,
    model: null,
    reasoningEffort: null,
    agents: [],
    ...overrides,
  };
}

export function commandItemFixture(overrides: Partial<CommandItem> & Pick<CommandItem, "statusLabel">): CommandItem {
  return {
    id: "cmd-1",
    kind: "command",
    role: "tool",
    turnId: "turn",
    cwd: "/vault",
    commandTarget: { kind: "command", commandLine: "npm run check" },
    command: "npm run check",
    ...overrides,
  };
}

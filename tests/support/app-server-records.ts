import type { TurnItem, TurnRecord } from "../../src/app-server/protocol/turn";
import type { Thread } from "../../src/generated/app-server/v2/Thread";
import type { Turn } from "../../src/generated/app-server/v2/Turn";

type TurnScenarioFields = "id" | "status" | "itemsView" | "items";

export function appServerTurnFixture(input: Pick<Turn, TurnScenarioFields> & Partial<Omit<Turn, TurnScenarioFields>>): Turn {
  return {
    rootTurnId: null,
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...input,
  };
}

type ThreadScenarioFields =
  | "id"
  | "sessionId"
  | "preview"
  | "ephemeral"
  | "historyMode"
  | "modelProvider"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "cwd"
  | "cliVersion"
  | "source"
  | "turns";

export function appServerThreadFixture(input: Pick<Thread, ThreadScenarioFields> & Partial<Omit<Thread, ThreadScenarioFields>>): Thread {
  return {
    extra: null,
    environments: null,
    originator: null,
    daybreakEnabled: null,
    forkedFromId: null,
    parentThreadId: null,
    projectId: null,
    model: null,
    reasoningEffort: null,
    recencyAt: null,
    section: null,
    sectionEnteredAt: null,
    path: null,
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    ...input,
  };
}

export function appServerCompletedTurnFixture(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return appServerTurnFixture({ id: "turn", items, itemsView: "full", status: "completed", ...overrides });
}

export function appServerUserMessageFixture(
  id: string,
  text: string,
  overrides: Partial<Extract<TurnItem, { type: "userMessage" }>> = {},
): Extract<TurnItem, { type: "userMessage" }> {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }], ...overrides };
}

export function appServerAgentMessageFixture(
  id: string,
  text: string,
  overrides: Partial<Extract<TurnItem, { type: "agentMessage" }>> = {},
): Extract<TurnItem, { type: "agentMessage" }> {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null, delivery: null, questions: null, ...overrides };
}

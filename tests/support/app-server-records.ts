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

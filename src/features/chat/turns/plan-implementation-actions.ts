import type { AppServerClient } from "../../../app-server/client";
import { closePanelsAction, setRequestedCollaborationModeDefaultAction } from "../chat-state-actions";
import { activeThreadId, canImplementPlan } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";
import type { DisplayItem } from "../display/types";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

interface PlanImplementationConnectionPort {
  currentClient(): AppServerClient | null;
  ensureConnected(): Promise<void>;
}

interface PlanImplementationSubmissionPort {
  sendTurnText(text: string): Promise<void>;
}

export interface PlanImplementationActionsHost {
  stateStore: ChatStateStore;
  connection: PlanImplementationConnectionPort;
  submission: PlanImplementationSubmissionPort;
}

export interface PlanImplementationActions {
  canImplement: (item: DisplayItem) => boolean;
  implement: (item: DisplayItem) => Promise<void>;
}

export function createPlanImplementationActions(host: PlanImplementationActionsHost): PlanImplementationActions {
  return {
    canImplement: (item) => canImplementPlan(host.stateStore.getState(), item),
    implement: (item) => implementPlan(host, item),
  };
}

async function implementPlan(host: PlanImplementationActionsHost, item: DisplayItem): Promise<void> {
  if (!canImplementPlan(host.stateStore.getState(), item)) return;
  await host.connection.ensureConnected();
  if (!host.connection.currentClient() || !activeThreadId(host.stateStore.getState())) return;

  host.stateStore.dispatch(setRequestedCollaborationModeDefaultAction());
  host.stateStore.dispatch(closePanelsAction());
  await host.submission.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

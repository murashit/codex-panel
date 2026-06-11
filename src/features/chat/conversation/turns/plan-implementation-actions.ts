import type { AppServerClient } from "../../../../app-server/client";
import { activeThreadId, canImplementPlan } from "../../state/selectors";
import type { ChatStateStore } from "../../state/reducer";
import type { DisplayItem } from "../../display/types";

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

  host.stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.submission.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

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

interface PlanImplementationRuntimePort {
  requestDefaultCollaborationModeForNextTurn(): void;
}

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  connection: PlanImplementationConnectionPort;
  submission: PlanImplementationSubmissionPort;
  runtime: PlanImplementationRuntimePort;
}

export interface PlanImplementation {
  canImplement: (item: DisplayItem) => boolean;
  implement: (item: DisplayItem) => Promise<void>;
}

export function createPlanImplementation(host: PlanImplementationHost): PlanImplementation {
  return {
    canImplement: (item) => canImplementPlan(host.stateStore.getState(), item),
    implement: (item) => implementPlan(host, item),
  };
}

async function implementPlan(host: PlanImplementationHost, item: DisplayItem): Promise<void> {
  if (!canImplementPlan(host.stateStore.getState(), item)) return;
  await host.connection.ensureConnected();
  if (!host.connection.currentClient() || !activeThreadId(host.stateStore.getState())) return;

  host.runtime.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.submission.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

import type { AppServerClient } from "../../../../app-server/connection/client";
import { activeThreadId, canImplementPlan } from "../state/selectors";
import type { ChatStateStore } from "../state/reducer";
import type { MessageStreamItem } from "../../domain/message-stream/items";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationHost {
  stateStore: ChatStateStore;
  currentClient(): AppServerClient | null;
  ensureConnected(): Promise<void>;
  sendTurnText(text: string): Promise<void>;
  requestDefaultCollaborationModeForNextTurn(): void;
}

export interface PlanImplementation {
  canImplement: (item: MessageStreamItem) => boolean;
  implement: (item: MessageStreamItem) => Promise<void>;
}

export function createPlanImplementation(host: PlanImplementationHost): PlanImplementation {
  return {
    canImplement: (item) => canImplementPlan(host.stateStore.getState(), item),
    implement: (item) => implementPlan(host, item),
  };
}

async function implementPlan(host: PlanImplementationHost, item: MessageStreamItem): Promise<void> {
  if (!canImplementPlan(host.stateStore.getState(), item)) return;
  await host.ensureConnected();
  if (!host.currentClient() || !activeThreadId(host.stateStore.getState())) return;

  host.requestDefaultCollaborationModeForNextTurn();
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  await host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
}

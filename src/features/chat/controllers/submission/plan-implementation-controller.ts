import type { AppServerClient } from "../../../../app-server/client";
import type { DisplayItem } from "../../display/types";
import type { SubmissionStatePort } from "../state-ports";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

export interface PlanImplementationControllerHost {
  state: SubmissionStatePort;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  sendTurnText: (text: string) => Promise<void>;
}

export class PlanImplementationController {
  constructor(private readonly host: PlanImplementationControllerHost) {}

  canImplement(item: DisplayItem): boolean {
    return this.host.state.canImplementPlan(item);
  }

  async implement(item: DisplayItem): Promise<void> {
    if (!this.canImplement(item)) return;
    await this.host.ensureConnected();
    if (!this.host.currentClient() || !this.host.state.snapshot().activeThreadId) return;

    this.host.state.prepareImplementationTurn();
    await this.host.sendTurnText(IMPLEMENT_PLAN_PROMPT);
  }
}

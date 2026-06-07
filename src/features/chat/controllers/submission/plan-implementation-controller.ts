import type { AppServerClient } from "../../../../app-server/client";
import type { DisplayItem } from "../../display/types";
import type { SubmissionStatePort } from "../state-ports";

const IMPLEMENT_PLAN_PROMPT = "Please implement this plan.";

interface PlanImplementationConnectionPort {
  currentClient(): AppServerClient | null;
  ensureConnected(): Promise<void>;
}

interface PlanImplementationSubmissionPort {
  sendTurnText(text: string): Promise<void>;
}

export interface PlanImplementationControllerHost {
  state: SubmissionStatePort;
  connection: PlanImplementationConnectionPort;
  submission: PlanImplementationSubmissionPort;
}

export class PlanImplementationController {
  constructor(private readonly host: PlanImplementationControllerHost) {}

  canImplement(item: DisplayItem): boolean {
    return this.host.state.canImplementPlan(item);
  }

  async implement(item: DisplayItem): Promise<void> {
    if (!this.canImplement(item)) return;
    await this.host.connection.ensureConnected();
    if (!this.host.connection.currentClient() || !this.host.state.snapshot().activeThreadId) return;

    this.host.state.prepareImplementationTurn();
    await this.host.submission.sendTurnText(IMPLEMENT_PLAN_PROMPT);
  }
}

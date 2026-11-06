import type { CodexInput } from "../../../../domain/input/input";
import type { ApprovalsReviewer } from "../../../../domain/runtime/settings";
import type { EffectOutcome } from "../effect-outcome";

interface ChatTurnStartRequest {
  approvalsReviewer?: ApprovalsReviewer;
  threadId: string;
  input: CodexInput;
  clientUserMessageId: string;
}

interface ChatTurnStartResult {
  turnId: string;
}

interface ChatTurnSteerRequest {
  threadId: string;
  turnId: string;
  input: CodexInput;
  clientUserMessageId: string;
}

type ChatTurnSteerOutcome =
  | EffectOutcome<void>
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "delivery-unknown" };

export interface ChatTurnPort {
  startTurn(request: ChatTurnStartRequest): Promise<EffectOutcome<ChatTurnStartResult>>;
  steerTurn(request: ChatTurnSteerRequest): Promise<ChatTurnSteerOutcome>;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

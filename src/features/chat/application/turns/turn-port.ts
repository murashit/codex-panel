import type { CodexInput } from "../../../../domain/turns/input";
import type { EffectOutcome } from "../effect-outcome";

interface ChatTurnStartRequest {
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
  | { readonly kind: "delivery-unknown"; readonly error: unknown };

export interface ChatTurnPort {
  ensureConnected(): Promise<boolean>;
  startTurn(request: ChatTurnStartRequest): Promise<EffectOutcome<ChatTurnStartResult>>;
  steerTurn(request: ChatTurnSteerRequest): Promise<ChatTurnSteerOutcome>;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

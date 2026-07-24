import type { CodexInput } from "../../../../domain/chat/input";
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

export interface ChatTurnPort {
  ensureConnected(): Promise<boolean>;
  startTurn(request: ChatTurnStartRequest): Promise<EffectOutcome<ChatTurnStartResult>>;
  steerTurn(request: ChatTurnSteerRequest): Promise<EffectOutcome<void>>;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

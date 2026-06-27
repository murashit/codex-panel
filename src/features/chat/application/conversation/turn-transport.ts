import type { CodexInput } from "../../../../domain/chat/input";

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

export interface ChatTurnTransport {
  ensureConnected(): Promise<boolean>;
  startTurn(request: ChatTurnStartRequest): Promise<ChatTurnStartResult | null>;
  steerTurn(request: ChatTurnSteerRequest): Promise<boolean>;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

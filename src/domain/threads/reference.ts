export const REFERENCED_THREAD_TURN_LIMIT = 20;

export interface ReferencedThreadMetadata {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
  omittedTurns?: number;
  truncated?: boolean;
}

interface ReferencedThreadMessage {
  kind: "user" | "assistant" | "plan";
  text: string;
}

export interface ReferencedThreadTurn {
  messages: readonly ReferencedThreadMessage[];
}

export interface ReferencedThreadTranscriptPage {
  turns: readonly ReferencedThreadTurn[];
  earlierTurnsAvailable: boolean;
}

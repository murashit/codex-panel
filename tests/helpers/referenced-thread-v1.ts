import type { Thread } from "../../src/domain/threads/model";
import { threadDisplayTitle } from "../../src/domain/threads/title";
import type { TurnTranscriptSummary } from "../../src/domain/threads/transcript";

export function referencedThreadV1Fixture(thread: Thread, turns: readonly TurnTranscriptSummary[], userRequest: string): string {
  return [
    "[Codex Panel referenced thread v1]",
    JSON.stringify({
      version: 1,
      threadId: thread.id,
      title: threadDisplayTitle(thread),
      includedTurns: turns.length,
      turnLimit: 20,
    }),
    "",
    "Reference thread history:",
    ...turns.flatMap((turn, index) => {
      const lines = [`Turn ${String(index + 1)}:`];
      if (turn.userText) lines.push(`User:\n${turn.userText}`);
      if (turn.assistantText) lines.push(`Codex:\n${turn.assistantText}`);
      return ["", ...lines];
    }),
    "",
    "[/Codex Panel referenced thread]",
    "",
    "Current user request:",
    userRequest,
  ].join("\n");
}

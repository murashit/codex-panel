import { describe, expect, it } from "vitest";

import { nonEmptyTurnTranscriptSummaries, turnTranscriptSummaryFromTranscriptEntries } from "../../../src/domain/threads/transcript";

describe("thread transcript model", () => {
  it("builds turn transcript summaries from the first user entry and last assistant-like entry", () => {
    expect(
      turnTranscriptSummaryFromTranscriptEntries([
        { kind: "assistant", text: "途中経過", timestamp: 1 },
        { kind: "user", text: "最初の依頼", timestamp: 2 },
        { kind: "user", text: "補足", timestamp: 3 },
        { kind: "plan", text: "最終計画", timestamp: 4 },
      ]),
    ).toEqual({ userText: "最初の依頼", assistantText: "最終計画" });
  });

  it("drops empty turn transcript summaries", () => {
    expect(
      nonEmptyTurnTranscriptSummaries([
        { userText: null, assistantText: null },
        { userText: "依頼", assistantText: null },
      ]),
    ).toEqual([{ userText: "依頼", assistantText: null }]);
  });
});

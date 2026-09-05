import { describe, expect, it } from "vitest";
import { threadTitleContextFromTurnTranscriptSummary } from "../../../src/domain/threads/title-context";

describe("thread title context", () => {
  it("builds title context from a turn transcript summary", () => {
    expect(
      threadTitleContextFromTurnTranscriptSummary({
        userText: "Codex Panelに自動命名を付けたい",
        assistantText: "実装方針をまとめました。",
      }),
    ).toEqual({
      userRequest: "Codex Panelに自動命名を付けたい",
      assistantResponse: "実装方針をまとめました。",
    });
  });

  it("does not build title context for incomplete turn transcript summaries", () => {
    expect(threadTitleContextFromTurnTranscriptSummary({ userText: "hello", assistantText: null })).toBeNull();
  });
});

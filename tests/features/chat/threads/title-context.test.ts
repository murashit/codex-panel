// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  firstThreadTitleContextFromMessageStreamItems,
  threadTitleContextFromMessageStreamItems,
} from "../../../../src/features/chat/threads/title-context";

describe("chat thread title context", () => {
  it("extracts title context from streamed display items when completed turn items are not loaded", () => {
    expect(
      threadTitleContextFromMessageStreamItems("turn", [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "自動命名を直したい", turnId: "turn" },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "原因を直しました。",
          turnId: "turn",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "自動命名を直したい",
      assistantResponse: "原因を直しました。",
    });
  });

  it("uses the first usable displayed turn as a resumed-history fallback", () => {
    expect(
      firstThreadTitleContextFromMessageStreamItems([
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "本文だけのturn", turnId: "turn-1" },
        { id: "u2", kind: "message", messageKind: "user", role: "user", text: "履歴から命名したい", turnId: "turn-2" },
        {
          id: "a2",
          kind: "message",
          role: "assistant",
          text: "表示済み履歴から候補を作ります。",
          turnId: "turn-2",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
        { id: "u3", kind: "message", messageKind: "user", role: "user", text: "後続turn", turnId: "turn-3" },
        {
          id: "a3",
          kind: "message",
          role: "assistant",
          text: "後続応答",
          turnId: "turn-3",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "履歴から命名したい",
      assistantResponse: "表示済み履歴から候補を作ります。",
    });
  });

  it("uses a preceding goal event objective when the first completed turn has no user item", () => {
    expect(
      threadTitleContextFromMessageStreamItems("turn", [
        {
          id: "goal",
          kind: "goal",
          role: "tool",
          text: "Goal set.",
          objective: "ゴールから始めたスレッドを命名したい",
        },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "ゴール内容に基づいて実装しました。",
          turnId: "turn",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "ゴールから始めたスレッドを命名したい",
      assistantResponse: "ゴール内容に基づいて実装しました。",
    });
  });

  it("finds the first visible display item title context", () => {
    expect(
      firstThreadTitleContextFromMessageStreamItems([
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "表示済み履歴から命名したい", turnId: "visible" },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "表示済み履歴を使います。",
          turnId: "visible",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ]),
    ).toEqual({
      userRequest: "表示済み履歴から命名したい",
      assistantResponse: "表示済み履歴を使います。",
    });
  });
});

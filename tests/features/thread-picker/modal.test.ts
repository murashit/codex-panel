// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import { threadOpenModeFromEvent, threadPickerSuggestions } from "../../../src/features/thread-picker/modal";

describe("threadPickerSuggestions", () => {
  it("orders title and id prefix matches before looser matches", () => {
    const suggestions = threadPickerSuggestions(
      [
        thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
        thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
        thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
      ],
      "alpha",
    );

    expect(suggestions.map((item) => item.thread.id)).toEqual(["alpha-thread", "thread-beta", "thread-alpha"]);
  });

  it("uses updated time for empty queries", () => {
    const suggestions = threadPickerSuggestions([thread({ id: "older", updatedAt: 10 }), thread({ id: "newer", updatedAt: 20 })], "");

    expect(suggestions.map((item) => item.thread.id)).toEqual(["newer", "older"]);
  });
});

describe("threadOpenModeFromEvent", () => {
  it("uses the current panel for plain Enter or mouse selection", () => {
    expect(threadOpenModeFromEvent(new KeyboardEvent("keydown", { key: "Enter" }))).toBe("current");
    expect(threadOpenModeFromEvent(new MouseEvent("click"))).toBe("current");
  });

  it("uses an available panel for Cmd/Ctrl+Enter", () => {
    expect(threadOpenModeFromEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }))).toBe("available");
    expect(threadOpenModeFromEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))).toBe("available");
  });
});

function thread(options: Partial<Thread> & { id: string }): Thread {
  return {
    id: options.id,
    sessionId: "session",
    forkedFromId: null,
    preview: options.preview ?? options.id,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: options.createdAt ?? 1,
    updatedAt: options.updatedAt ?? 1,
    status: { type: "idle" },
    path: null,
    cwd: options.cwd ?? "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: options.name ?? null,
    turns: [],
  } as Thread;
}

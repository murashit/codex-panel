import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { upsertThreadStreamItemById } from "../../../../../src/features/chat/domain/thread-stream/updates";

describe("thread stream item updates", () => {
  it("does not overwrite streamed output with an empty completed item", () => {
    const streamed: ThreadStreamItem = {
      id: "c1",
      sourceItemId: "c1",
      kind: "command",
      role: "tool",
      commandAction: "command",
      commandTarget: { kind: "command", commandLine: "Command running" },
      command: "npm test",
      cwd: "/vault",
      status: "running",
      output: "partial output",
    };
    const completed: ThreadStreamItem = {
      id: "c1",
      sourceItemId: "c1",
      kind: "command",
      role: "tool",
      commandAction: "command",
      commandTarget: { kind: "command", commandLine: "npm test" },
      command: "npm test",
      cwd: "/vault",
      status: "completed",
      output: "",
    };

    expect(upsertThreadStreamItemById([streamed], completed)[0]).toMatchObject({
      output: "partial output",
      status: "completed",
    });
  });
});

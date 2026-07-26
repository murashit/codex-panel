import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "../../../../../src/features/chat/application/slash-commands/parse";

describe("parseSlashCommand", () => {
  it.each([
    { input: "/status", expected: { command: "status", args: "" } },
    { input: "/clear", expected: { command: "clear", args: "" } },
    { input: "/resume thread-1", expected: { command: "resume", args: "thread-1" } },
    { input: "/refer thread-1 続きです", expected: { command: "refer", args: "thread-1 続きです" } },
    { input: "/web https://example.com/article 要約して", expected: { command: "web", args: "https://example.com/article 要約して" } },
    { input: "/fork", expected: { command: "fork", args: "" } },
    { input: "/archive thread-1", expected: { command: "archive", args: "thread-1" } },
    { input: "/rename thread-1 New name", expected: { command: "rename", args: "thread-1 New name" } },
    { input: "/doctor", expected: { command: "doctor", args: "" } },
    { input: "/fast now", expected: { command: "fast", args: "now" } },
    { input: "/plan", expected: { command: "plan", args: "" } },
    { input: "/plan OK、実装してください", expected: { command: "plan", args: "OK、実装してください" } },
    { input: "/model gpt-5.5", expected: { command: "model", args: "gpt-5.5" } },
    { input: "/permissions :workspace", expected: { command: "permissions", args: ":workspace" } },
    { input: "/reasoning high", expected: { command: "reasoning", args: "high" } },
    { input: "/new", expected: null },
    { input: "/unknown", expected: null },
  ])("parses $input", ({ input, expected }) => {
    expect(parseSlashCommand(input)).toEqual(expected);
  });
});

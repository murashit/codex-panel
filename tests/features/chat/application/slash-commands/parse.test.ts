import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "../../../../../src/features/chat/application/slash-commands/parse";

describe("parseSlashCommand", () => {
  it.each([
    { input: "/status", expected: { command: "status", args: "" } },
    { input: "/refer thread-1 続きです", expected: { command: "refer", args: "thread-1 続きです" } },
    { input: "/unknown", expected: null },
  ])("parses $input", ({ input, expected }) => {
    expect(parseSlashCommand(input)).toEqual(expected);
  });
});

import { describe, expect, it } from "vitest";
import { appServerTurnInputFromCodexInput, toAppServerUserInput } from "../../../src/app-server/protocol/request-input";
import { type CodexInput, codexTextInputWithAttachments, codexTextInputWithReferences } from "../../../src/domain/input/input";

const ADDITIONAL_CONTEXT_MAX_PARTS = 8;
const PANEL_SUBMISSION_ID = "local-user-1-seed-1-1";

describe("app-server request input", () => {
  it("replaces text input while preserving non-text attachments", () => {
    const input: CodexInput = [
      { type: "text", text: "visible request" },
      { type: "fileReference", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" },
    ];

    expect(codexTextInputWithAttachments("rewritten prompt", input)).toEqual([
      { type: "text", text: "rewritten prompt" },
      { type: "fileReference", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" },
    ]);
  });

  it("serializes text input for app-server requests", () => {
    const input = codexTextInputWithReferences(
      "Use [[Note]]",
      [{ name: "Note", path: "Note.md" }],
      [{ name: "Review", path: ".codex/skills/review/SKILL.md" }],
      [{ key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" }],
    );

    const expectedInput = [
      { type: "text", text: "Use [[Note]]", text_elements: [] },
      { type: "skill", name: "Review", path: ".codex/skills/review/SKILL.md" },
    ];
    const prepared = appServerTurnInputFromCodexInput(input, "local-user");
    expect(prepared.input).toEqual(expectedInput);
    expect(prepared.additionalContext).toEqual({
      "codex_panel.local-user.00.codex_panel_obsidian_context.part_01_of_01": {
        kind: "untrusted",
        value: "Codex Panel context part 1/1.\nSource: codex_panel_obsidian_context\n\n- [[Note]] -> Note.md",
      },
    });
  });

  it("serializes supported attachments without persisting panel-only references", () => {
    const input: CodexInput = [
      { type: "image", url: "https://example.com/image.png", detail: "high" },
      { type: "localImage", path: "/vault/image.png" },
      { type: "skill", name: "Review", path: ".codex/skills/review/SKILL.md" },
      { type: "fileReference", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "context", kind: "untrusted", value: "reference" },
    ];

    expect(toAppServerUserInput(input)).toEqual([
      { type: "image", url: "https://example.com/image.png", detail: "high" },
      { type: "localImage", path: "/vault/image.png" },
      { type: "skill", name: "Review", path: ".codex/skills/review/SKILL.md" },
    ]);
  });

  it("chunks UTF-8 context within the Panel byte cap without adding visible metadata", () => {
    const value = Array.from({ length: 2_000 }, (_, index) => `段落[${String(index)}]: 本文です。🌿\n`).join("");
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "要約して" },
        {
          type: "additionalContext",
          key: "codex_panel_web_context",
          kind: "untrusted",
          value,
        },
      ],
      PANEL_SUBMISSION_ID,
    );

    const entries = Object.entries(prepared.additionalContext ?? {});
    expect(entries).toHaveLength(ADDITIONAL_CONTEXT_MAX_PARTS);
    expect(entries.map(([key]) => key)).toEqual([...entries.map(([key]) => key)].sort());
    const bodies = entries.map(([, entry]) => {
      expect(entry.kind).toBe("untrusted");
      expect(Buffer.byteLength(entry.value, "utf8")).toBeLessThan(4_000);
      const separator = entry.value.indexOf("\n\n");
      return entry.value.slice(separator + 2);
    });
    const truncationNotice = "\n\n[Context truncated by Codex Panel: remaining content omitted.]";
    const serializedBody = bodies.join("");
    expect(serializedBody.endsWith(truncationNotice)).toBe(true);
    const includedBody = serializedBody.slice(0, -truncationNotice.length);
    expect(bodies.every((body) => body.length > 0)).toBe(true);
    expect(value.startsWith(includedBody)).toBe(true);
    expect(includedBody.length).toBeLessThan(value.length);

    expect(prepared.input).toEqual([{ type: "text", text: "要約して", text_elements: [] }]);
  });

  it("namespaces identical explicit context by submission", () => {
    const input: CodexInput = [
      { type: "text", text: "read it" },
      { type: "additionalContext", key: "same", kind: "untrusted", value: "same" },
    ];
    const first = Object.keys(appServerTurnInputFromCodexInput(input, "first").additionalContext ?? {});
    const second = Object.keys(appServerTurnInputFromCodexInput(input, "second").additionalContext ?? {});
    expect(first).not.toEqual(second);
  });

  it("reserves at least one part for every explicit context source", () => {
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "compare them" },
        { type: "additionalContext", key: "web", kind: "untrusted", value: "w".repeat(30_000) },
        { type: "additionalContext", key: "selection", kind: "untrusted", value: "selected text" },
      ],
      PANEL_SUBMISSION_ID,
    );
    const entries = Object.entries(prepared.additionalContext ?? {});

    expect(entries).toHaveLength(ADDITIONAL_CONTEXT_MAX_PARTS);
    expect(entries.some(([key, entry]) => key.includes(".selection.") && entry.value.includes("selected text"))).toBe(true);
    expect(entries.filter(([key]) => key.includes(".web."))).toHaveLength(7);
  });

  it("accepts eight explicit context sources and ignores empty sources without spending the budget", () => {
    const contexts = Array.from(
      { length: ADDITIONAL_CONTEXT_MAX_PARTS },
      (_, index) =>
        ({
          type: "additionalContext",
          key: `source-${String(index)}`,
          kind: "untrusted",
          value: `value-${String(index)}`,
        }) satisfies CodexInput[number],
    );
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "compare them" },
        { type: "additionalContext", key: "", kind: "untrusted", value: "ignored empty key" },
        { type: "additionalContext", key: "empty-value", kind: "untrusted", value: "" },
        ...contexts,
      ],
      "local-user",
    );
    const entries = Object.entries(prepared.additionalContext ?? {});

    expect(entries).toHaveLength(ADDITIONAL_CONTEXT_MAX_PARTS);
    expect(entries.map(([, entry]) => entry.value)).toEqual(
      contexts.map(({ key, value }) => `Codex Panel context part 1/1.\nSource: ${key}\n\n${value}`),
    );
  });

  it("rejects nine explicit context sources", () => {
    const contexts: CodexInput = Array.from({ length: ADDITIONAL_CONTEXT_MAX_PARTS + 1 }, (_, index) => ({
      type: "additionalContext",
      key: `source-${String(index)}`,
      kind: "untrusted",
      value: `value-${String(index)}`,
    }));

    expect(() => appServerTurnInputFromCodexInput(contexts, "local-user")).toThrowError(
      `Too many additional context sources (${String(ADDITIONAL_CONTEXT_MAX_PARTS + 1)}).`,
    );
  });
});

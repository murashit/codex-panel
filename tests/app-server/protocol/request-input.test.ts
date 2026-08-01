import { describe, expect, it } from "vitest";
import { appServerTurnInputFromCodexInput, toAppServerUserInput } from "../../../src/app-server/protocol/request-input";
import { utf8ByteLength } from "../../../src/domain/turns/context-budget";
import { type CodexInput, codexTextInputWithAttachments, codexTextInputWithReferences } from "../../../src/domain/turns/input";

const ADDITIONAL_CONTEXT_MAX_PARTS = 8;
const PANEL_SUBMISSION_ID = "local-user-1-seed-1-1";

describe("app-server request input", () => {
  it("builds text input with file references and skills", () => {
    expect(
      codexTextInputWithReferences(
        "Use [[Note]] and $Skill",
        [{ name: "Note", path: "Note.md" }],
        [{ name: "Skill", path: ".codex/skills/skill/SKILL.md" }],
        [
          {
            key: "codex_panel_obsidian_context",
            kind: "untrusted",
            value: "Obsidian context for the current user input:\nResolved wikilinks:\n- [[Note]] -> Note.md",
          },
        ],
      ),
    ).toEqual([
      { type: "text", text: "Use [[Note]] and $Skill" },
      { type: "fileReference", name: "Note", path: "Note.md" },
      { type: "skill", name: "Skill", path: ".codex/skills/skill/SKILL.md" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian context for the current user input:\nResolved wikilinks:\n- [[Note]] -> Note.md",
      },
    ]);
  });

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
      [],
      [{ key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" }],
    );

    expect(toAppServerUserInput(input)).toEqual([{ type: "text", text: "Use [[Note]]", text_elements: [] }]);
    const prepared = appServerTurnInputFromCodexInput(input, "local-user");
    expect(prepared.input).toEqual([{ type: "text", text: "Use [[Note]]", text_elements: [] }]);
    expect(prepared.additionalContext).toEqual({
      "codex_panel.local-user.00.codex_panel_obsidian_context.part_01_of_01": {
        kind: "untrusted",
        value: "Codex Panel context part 1/1.\nSource: codex_panel_obsidian_context\n\n- [[Note]] -> Note.md",
      },
    });
  });

  it("does not persist Vault file-reference display metadata in app-server history", () => {
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "Use [[Note]]" },
        { type: "fileReference", name: "Note", path: "Note.md" },
      ],
      "local-user-1-seed-1-1",
    );

    expect(prepared.additionalContext).toBeUndefined();
    expect(prepared.input).toEqual([{ type: "text", text: "Use [[Note]]", text_elements: [] }]);
    expect(prepared.input).not.toContainEqual(expect.objectContaining({ type: "mention" }));
  });

  it("does not persist metadata for Vault files or explicit context", () => {
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "Read the linked notes" },
        ...Array.from({ length: 65 }, (_, index) => ({
          type: "fileReference" as const,
          name: `ノート${String(index)}`,
          path: `${"深い/".repeat(20)}ノート${String(index)}.md`,
        })),
        {
          type: "additionalContext" as const,
          key: "codex_panel_web_context",
          kind: "untrusted" as const,
          value: "page",
        },
      ],
      "local-user-1-seed-1-1",
    );

    expect(prepared.input).toEqual([{ type: "text", text: "Read the linked notes", text_elements: [] }]);
    expect(prepared.additionalContext).toMatchObject({
      "codex_panel.local-user-1-seed-1-1.00.codex_panel_web_context.part_01_of_01": {
        kind: "untrusted",
      },
    });
  });

  it("chunks UTF-8 context within the Panel byte cap without adding visible metadata", () => {
    const value = `見出し\n\n${"本文です。".repeat(2_000)}`;
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
    expect(entries.every(([, entry]) => utf8ByteLength(entry.value) < 4_000)).toBe(true);
    expect(entries.every(([, entry]) => entry.value.includes("Codex Panel context part"))).toBe(true);
    expect(entries.at(-1)?.[1].value).toContain("[Context truncated by Codex Panel: remaining content omitted.]");

    expect(prepared.input).toEqual([{ type: "text", text: "要約して", text_elements: [] }]);
    expect(prepared.input.some((item) => item.type === "text" && item.text.includes("[Codex Panel context v2]"))).toBe(false);
  });

  it("keeps Obsidian reference metadata ahead of a truncated inline excerpt", () => {
    const reference = "[[Note]] (L2:C1-L3:C1) -> Note.md";
    const value = [
      "Obsidian references for the current user input:",
      `- ${reference} (inline excerpt below)`,
      "",
      "Inline excerpts:",
      "[[Note]] (L2:C1-L3:C1):",
      "本文".repeat(20_000),
    ].join("\n");
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "review it" },
        {
          type: "additionalContext",
          key: "codex_panel_obsidian_context",
          kind: "untrusted",
          value,
        },
      ],
      PANEL_SUBMISSION_ID,
    );

    const firstPart = Object.values(prepared.additionalContext ?? {})[0];
    expect(firstPart?.value).toContain(reference);
    expect(prepared.input).toEqual([{ type: "text", text: "review it", text_elements: [] }]);
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
    expect(entries.filter(([key]) => key.includes(".web.")).at(-1)?.[1].value).toContain(
      "[Context truncated by Codex Panel: remaining content omitted.]",
    );
    expect(prepared.input).toEqual([{ type: "text", text: "compare them", text_elements: [] }]);
  });

  it("does not add a truncation notice when the complete context fits", () => {
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "read it" },
        { type: "additionalContext", key: "selection", kind: "untrusted", value: "selected text" },
      ],
      PANEL_SUBMISSION_ID,
    );

    expect(Object.values(prepared.additionalContext ?? {})[0]?.value).not.toContain("Context truncated by Codex Panel");
  });

  it("accepts eight explicit context sources and ignores empty sources without spending the budget", () => {
    const nonContextItem = {
      type: "text",
      text: "compare them",
      key: "text-is-not-context",
      value: "text-is-not-context",
    } as const;
    const contexts: CodexInput = Array.from({ length: ADDITIONAL_CONTEXT_MAX_PARTS }, (_, index) => ({
      type: "additionalContext",
      key: `source-${String(index)}`,
      kind: "untrusted",
      value: `value-${String(index)}`,
    }));
    const prepared = appServerTurnInputFromCodexInput(
      [
        nonContextItem,
        { type: "additionalContext", key: "", kind: "untrusted", value: "ignored empty key" },
        { type: "additionalContext", key: "empty-value", kind: "untrusted", value: "" },
        ...contexts,
      ],
      "local-user",
    );
    const entries = Object.entries(prepared.additionalContext ?? {});

    expect(entries).toHaveLength(ADDITIONAL_CONTEXT_MAX_PARTS);
    expect(entries.map(([, entry]) => entry.value)).toEqual(
      contexts.map((context, index) =>
        [
          "Codex Panel context part 1/1.",
          `Source: source-${String(index)}`,
          "",
          context.type === "additionalContext" ? context.value : "",
        ].join("\n"),
      ),
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

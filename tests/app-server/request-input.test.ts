import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_CONTEXT_MAX_PARTS,
  ADDITIONAL_CONTEXT_PART_BODY_MAX_BYTES,
  additionalContextFromCodexInput,
  appServerTurnInputFromCodexInput,
  toAppServerUserInput,
} from "../../src/app-server/protocol/request-input";
import { utf8ByteLength } from "../../src/domain/chat/context-budget";
import { turnContextManifestFromText } from "../../src/domain/chat/context-manifest";
import { type CodexInput, codexTextInputWithAttachments, codexTextInputWithMentions } from "../../src/domain/chat/input";

describe("app-server request input", () => {
  it("builds text input with mentions and skills", () => {
    expect(
      codexTextInputWithMentions(
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
      { type: "mention", name: "Note", path: "Note.md" },
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
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" },
    ];

    expect(codexTextInputWithAttachments("rewritten prompt", input)).toEqual([
      { type: "text", text: "rewritten prompt" },
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" },
    ]);
  });

  it("serializes text input for app-server requests", () => {
    const input = codexTextInputWithMentions(
      "Use [[Note]]",
      [{ name: "Note", path: "Note.md" }],
      [],
      [{ key: "codex_panel_obsidian_context", kind: "untrusted", value: "- [[Note]] -> Note.md" }],
    );

    expect(toAppServerUserInput(input)).toEqual([
      { type: "text", text: "Use [[Note]]", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
    ]);
    expect(additionalContextFromCodexInput(input, "local-user")).toEqual({
      "codex_panel.local-user.00.codex_panel_obsidian_context.part_01_of_01": {
        kind: "untrusted",
        value: "Codex Panel context part 1/1.\nSource: codex_panel_obsidian_context\n\n- [[Note]] -> Note.md",
      },
    });
  });

  it("chunks UTF-8 context below the upstream value cap and persists an inert manifest", () => {
    const value = `見出し\n\n${"本文です。".repeat(2_000)}`;
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "要約して" },
        {
          type: "additionalContext",
          key: "codex_panel_web_context",
          kind: "untrusted",
          value,
          attachment: { kind: "web" },
        },
      ],
      "local-user-1",
    );

    const entries = Object.entries(prepared.additionalContext ?? {});
    expect(entries).toHaveLength(ADDITIONAL_CONTEXT_MAX_PARTS);
    expect(entries.map(([key]) => key)).toEqual([...entries.map(([key]) => key)].sort());
    expect(entries.every(([, entry]) => utf8ByteLength(entry.value) < 4_000)).toBe(true);
    expect(entries.every(([, entry]) => entry.value.includes("Codex Panel context part"))).toBe(true);
    expect(ADDITIONAL_CONTEXT_PART_BODY_MAX_BYTES).toBeLessThan(4_000);

    const manifestInput = prepared.input.at(-1);
    expect(manifestInput?.type).toBe("text");
    const manifest = manifestInput?.type === "text" ? turnContextManifestFromText(manifestInput.text) : null;
    expect(manifest?.contexts).toEqual([
      expect.objectContaining({
        kind: "web",
        parts: ADDITIONAL_CONTEXT_MAX_PARTS,
        truncated: true,
        sourceBytes: utf8ByteLength(value),
      }),
    ]);
    expect(manifestInput?.type === "text" ? manifestInput.text : "").not.toContain("本文です");
  });

  it("namespaces identical explicit context by submission", () => {
    const input: CodexInput = [
      { type: "text", text: "read it" },
      { type: "additionalContext", key: "same", kind: "untrusted", value: "same" },
    ];
    const first = Object.keys(additionalContextFromCodexInput(input, "first") ?? {});
    const second = Object.keys(additionalContextFromCodexInput(input, "second") ?? {});
    expect(first).not.toEqual(second);
  });

  it("reserves at least one part for every explicit context source", () => {
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "compare them" },
        { type: "additionalContext", key: "web", kind: "untrusted", value: "w".repeat(30_000), attachment: { kind: "web" } },
        { type: "additionalContext", key: "selection", kind: "untrusted", value: "selected text" },
      ],
      "local-user",
    );
    const entries = Object.entries(prepared.additionalContext ?? {});

    expect(entries).toHaveLength(ADDITIONAL_CONTEXT_MAX_PARTS);
    expect(entries.some(([key, entry]) => key.includes(".selection.") && entry.value.includes("selected text"))).toBe(true);
    const manifestInput = prepared.input.at(-1);
    const manifest = manifestInput?.type === "text" ? turnContextManifestFromText(manifestInput.text) : null;
    expect(manifest?.contexts.map((context) => context.parts)).toEqual([7, 1]);
  });
});

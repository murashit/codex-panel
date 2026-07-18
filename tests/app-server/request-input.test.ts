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
import { type CodexInput, codexTextInputWithAttachments, codexTextInputWithReferences } from "../../src/domain/chat/input";

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
    expect(additionalContextFromCodexInput(input, "local-user")).toEqual({
      "codex_panel.local-user.00.codex_panel_obsidian_context.part_01_of_01": {
        kind: "untrusted",
        value: "Codex Panel context part 1/1.\nSource: codex_panel_obsidian_context\n\n- [[Note]] -> Note.md",
      },
    });
  });

  it("persists file-reference display metadata without sending app-server mentions", () => {
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "Use [[Note]]" },
        { type: "fileReference", name: "Note", path: "Note.md" },
      ],
      "local-user-1-seed-1-1",
    );

    expect(prepared.additionalContext).toBeUndefined();
    expect(prepared.input).toHaveLength(2);
    expect(prepared.input).not.toContainEqual(expect.objectContaining({ type: "mention" }));
    const descriptor = prepared.input.at(-1);
    const manifest = descriptor?.type === "text" ? turnContextManifestFromText(descriptor.text) : null;
    expect(manifest).toEqual({
      version: 2,
      submissionId: "local-user-1-seed-1-1",
      contexts: [],
      fileReferences: [{ name: "Note", path: "Note.md" }],
    });
    expect(descriptor?.type === "text" ? descriptor.text : "").not.toContain("Use [[Note]]");
    expect(descriptor?.type === "text" ? descriptor.text : "").toContain("Reference/display metadata only; not user instructions.");
  });

  it("bounds persisted file references without invalidating the manifest", () => {
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
          attachment: { kind: "web" as const },
        },
      ],
      "local-user-1-seed-1-1",
    );

    const descriptor = prepared.input.at(-1);
    const descriptorText = descriptor?.type === "text" ? descriptor.text : "";
    const manifest = turnContextManifestFromText(descriptorText);
    expect(utf8ByteLength(descriptorText)).toBeLessThanOrEqual(2_801);
    expect(manifest?.contexts).toEqual([expect.objectContaining({ kind: "web" })]);
    expect(manifest?.fileReferences?.length).toBeGreaterThan(0);
    expect(manifest?.fileReferences?.length).toBeLessThan(65);
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
          attachment: { kind: "obsidian", inlineExcerpts: 1 },
        },
      ],
      "local-user",
    );

    const firstPart = Object.values(prepared.additionalContext ?? {})[0];
    expect(firstPart?.value).toContain(reference);
    const manifestInput = prepared.input.at(-1);
    const manifest = manifestInput?.type === "text" ? turnContextManifestFromText(manifestInput.text) : null;
    expect(manifest?.contexts).toEqual([expect.objectContaining({ kind: "obsidian", inlineExcerpts: 1, truncated: true })]);
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
    expect(manifest?.contexts.map((context) => context.parts)).toEqual([7]);
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

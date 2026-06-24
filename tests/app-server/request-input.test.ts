import { describe, expect, it } from "vitest";
import { additionalContextFromCodexInput, toAppServerUserInput } from "../../src/app-server/protocol/request-input";
import { type CodexInput, codexTextInputWithAttachments, codexTextInputWithMentions } from "../../src/domain/chat/input";

describe("app-server request input", () => {
  it("builds text input with mentions and skills", () => {
    expect(
      codexTextInputWithMentions(
        "Use [[Note]] and $Skill",
        [{ name: "Note", path: "Note.md" }],
        [{ name: "Skill", path: ".codex/skills/skill/SKILL.md" }],
        [{ key: "codex_panel_wikilinks", kind: "untrusted", value: "Resolved Obsidian wikilinks:\n- [[Note]] -> Note.md" }],
      ),
    ).toEqual([
      { type: "text", text: "Use [[Note]] and $Skill" },
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "skill", name: "Skill", path: ".codex/skills/skill/SKILL.md" },
      {
        type: "additionalContext",
        key: "codex_panel_wikilinks",
        kind: "untrusted",
        value: "Resolved Obsidian wikilinks:\n- [[Note]] -> Note.md",
      },
    ]);
  });

  it("replaces text input while preserving non-text attachments", () => {
    const input: CodexInput = [
      { type: "text", text: "visible request" },
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "codex_panel_wikilinks", kind: "untrusted", value: "- [[Note]] -> Note.md" },
    ];

    expect(codexTextInputWithAttachments("rewritten prompt", input)).toEqual([
      { type: "text", text: "rewritten prompt" },
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "additionalContext", key: "codex_panel_wikilinks", kind: "untrusted", value: "- [[Note]] -> Note.md" },
    ]);
  });

  it("serializes text input for app-server requests", () => {
    const input = codexTextInputWithMentions(
      "Use [[Note]]",
      [{ name: "Note", path: "Note.md" }],
      [],
      [{ key: "codex_panel_wikilinks", kind: "untrusted", value: "- [[Note]] -> Note.md" }],
    );

    expect(toAppServerUserInput(input)).toEqual([
      { type: "text", text: "Use [[Note]]", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
    ]);
    expect(additionalContextFromCodexInput(input)).toEqual({
      codex_panel_wikilinks: { kind: "untrusted", value: "- [[Note]] -> Note.md" },
    });
  });
});

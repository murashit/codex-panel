import { describe, expect, it } from "vitest";

import {
  codexTextInputWithAttachments,
  codexTextInputWithMentions,
  toAppServerUserInput,
  type CodexInput,
} from "../../src/app-server/request-input";

describe("app-server request input", () => {
  it("builds text input with mentions and skills", () => {
    expect(
      codexTextInputWithMentions(
        "Use [[Note]] and $Skill",
        [{ name: "Note", path: "Note.md" }],
        [{ name: "Skill", path: ".codex/skills/skill/SKILL.md" }],
      ),
    ).toEqual([
      { type: "text", text: "Use [[Note]] and $Skill" },
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "skill", name: "Skill", path: ".codex/skills/skill/SKILL.md" },
    ]);
  });

  it("replaces text input while preserving non-text attachments", () => {
    const input: CodexInput = [
      { type: "text", text: "visible request" },
      { type: "mention", name: "Note", path: "Note.md" },
    ];

    expect(codexTextInputWithAttachments("rewritten prompt", input)).toEqual([
      { type: "text", text: "rewritten prompt" },
      { type: "mention", name: "Note", path: "Note.md" },
    ]);
  });

  it("serializes text input for app-server requests", () => {
    expect(toAppServerUserInput(codexTextInputWithMentions("Use [[Note]]", [{ name: "Note", path: "Note.md" }]))).toEqual([
      { type: "text", text: "Use [[Note]]", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
    ]);
  });
});

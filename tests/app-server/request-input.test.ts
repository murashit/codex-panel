import { describe, expect, it } from "vitest";

import { appServerTextInputWithAttachments, appServerTextInputWithMentions } from "../../src/app-server/request-input";
import type { UserInput } from "../../src/generated/app-server/v2/UserInput";

describe("app-server request input", () => {
  it("builds text input with mentions and skills", () => {
    expect(
      appServerTextInputWithMentions(
        "Use [[Note]] and $Skill",
        [{ name: "Note", path: "Note.md" }],
        [{ name: "Skill", path: ".codex/skills/skill/SKILL.md" }],
      ),
    ).toEqual([
      { type: "text", text: "Use [[Note]] and $Skill", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
      { type: "skill", name: "Skill", path: ".codex/skills/skill/SKILL.md" },
    ]);
  });

  it("replaces text input while preserving non-text attachments", () => {
    const input: UserInput[] = [
      { type: "text", text: "visible request", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
    ];

    expect(appServerTextInputWithAttachments("rewritten prompt", input)).toEqual([
      { type: "text", text: "rewritten prompt", text_elements: [] },
      { type: "mention", name: "Note", path: "Note.md" },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  vaultMarkdownFilenameFromTemplate,
  vaultMarkdownTemplateDate,
  vaultMarkdownTemplateTime,
} from "../../../src/domain/vault/markdown-write-templates";

describe("Vault Markdown write templates", () => {
  it("formats local date and time tokens with fixed-width fields", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(vaultMarkdownTemplateDate(date)).toBe("2026-01-02");
    expect(vaultMarkdownTemplateTime(date)).toBe("030405");
  });

  it("expands tokens and sanitizes path separators into one Markdown filename", () => {
    expect(
      vaultMarkdownFilenameFromTemplate(
        "{{title}}/{{date}}.MD",
        { title: "Review", date: "2026-08-03" },
        (path) => path,
        "Filename required",
      ),
    ).toBe("Review-2026-08-03.MD");
  });

  it.each(["", ".", ".."])("rejects an empty filename after sanitization: %s", (template) => {
    expect(() => vaultMarkdownFilenameFromTemplate(template, {}, (path) => path, "Filename required")).toThrow("Filename required");
  });
});

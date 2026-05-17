import { describe, expect, it } from "vitest";

import {
  parsedSkillReferences,
  parsedWikiLinks,
  userInputWithWikiLinkMentions,
  userInputWithWikiLinkMentionsAndSkills,
} from "../../src/composer/wikilink-context";

describe("wikilink context", () => {
  it("parses aliases, subpaths, and duplicate links", () => {
    expect(parsedWikiLinks("See [[Alpha|label]], [[Beta#Heading]], [[Gamma^block]], and [[Alpha]].")).toEqual([
      { raw: "Alpha|label", target: "Alpha", subpath: "", display: "label" },
      { raw: "Beta#Heading", target: "Beta", subpath: "#Heading", display: "" },
      { raw: "Gamma^block", target: "Gamma", subpath: "^block", display: "" },
    ]);
  });

  it("adds only resolved file mentions without changing the visible prompt body", () => {
    const text = "Please compare [[Alpha#Heading|A]] and [[Missing]].";
    const input = userInputWithWikiLinkMentions(text, (target) =>
      target === "Alpha" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null,
    );

    expect(input).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
    ]);
    expect(input).toHaveLength(2);
  });

  it("deduplicates mentions by resolved path", () => {
    const text = "Read [[Alpha]], [[Alpha#Heading]], and [[Alias|A]].";
    const input = userInputWithWikiLinkMentions(text, (target) =>
      target === "Alpha" || target === "Alias" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null,
    );

    expect(input).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
    ]);
  });

  it("parses complete skill references", () => {
    expect(parsedSkillReferences("Use $obsidian-codex-panel-maintain and ($github:yeet), but not $missing.")).toEqual([
      "obsidian-codex-panel-maintain",
      "github:yeet",
      "missing",
    ]);
  });

  it("adds resolved skill input without changing the visible prompt body", () => {
    const text = "Please use $obsidian-codex-panel-maintain with [[Alpha]].";
    const input = userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => (target === "Alpha" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null),
      [
        {
          name: "obsidian-codex-panel-maintain",
          description: "Maintain Codex Panel",
          path: "/vault/___/skills/obsidian-codex-panel-maintain/SKILL.md",
          scope: "repo",
          enabled: true,
        } as never,
      ],
    );

    expect(input).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
      {
        type: "skill",
        name: "obsidian-codex-panel-maintain",
        path: "/vault/___/skills/obsidian-codex-panel-maintain/SKILL.md",
      },
    ]);
  });

  it("ignores unresolved skills and deduplicates resolved skills by path", () => {
    const text = "Use $First, $missing, $first, and $Alias.";
    const input = userInputWithWikiLinkMentionsAndSkills(text, () => null, [
      {
        name: "First",
        description: "First skill",
        path: "/skills/first/SKILL.md",
        scope: "user",
        enabled: true,
      } as never,
      {
        name: "first",
        description: "Duplicate name should not win",
        path: "/skills/duplicate/SKILL.md",
        scope: "user",
        enabled: true,
      } as never,
      {
        name: "Alias",
        description: "Same path alias",
        path: "/skills/first/SKILL.md",
        scope: "user",
        enabled: true,
      } as never,
      {
        name: "missing",
        description: "Disabled skill",
        path: "/skills/missing/SKILL.md",
        scope: "user",
        enabled: false,
      } as never,
    ]);

    expect(input).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "skill", name: "First", path: "/skills/first/SKILL.md" },
    ]);
  });
});

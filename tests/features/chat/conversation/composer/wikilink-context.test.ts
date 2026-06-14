import { describe, expect, it } from "vitest";

import { userInputWithWikiLinkMentionsAndSkills } from "../../../../../src/features/chat/application/composer/wikilink-context";

describe("wikilink context", () => {
  it("parses aliases, subpaths, and duplicate links", () => {
    const text = "See [[Alpha|label]], [[Beta#Heading]], [[Gamma^block]], and [[Alpha]].";
    const input = userInputWithWikiLinkMentionsAndSkills(text, (target) => ({ name: target, path: `${target}.md` }), []);

    expect(input).toEqual([
      { type: "text", text },
      { type: "mention", name: "Alpha", path: "Alpha.md" },
      { type: "mention", name: "Beta", path: "Beta.md" },
      { type: "mention", name: "Gamma", path: "Gamma.md" },
    ]);
  });

  it("adds only resolved file mentions without changing the visible prompt body", () => {
    const text = "Please compare [[Alpha#Heading|A]] and [[Missing]].";
    const input = userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => (target === "Alpha" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null),
      [],
    );

    expect(input).toEqual([
      { type: "text", text },
      { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
    ]);
    expect(input).toHaveLength(2);
  });

  it("resolves aliases and subpaths from non-markdown wikilinks by target", () => {
    const text = "Open [[Bases/Projects.base|Projects]], [[References/Paper.pdf]], and [[Assets/Diagram.png#crop|Diagram]].";
    const input = userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => {
        const mentions = new Map([
          ["Bases/Projects.base", { name: "Projects", path: "Bases/Projects.base" }],
          ["References/Paper.pdf", { name: "Paper", path: "References/Paper.pdf" }],
          ["Assets/Diagram.png", { name: "Diagram", path: "Assets/Diagram.png" }],
        ]);
        return mentions.get(target) ?? null;
      },
      [],
    );
    expect(input).toEqual([
      { type: "text", text },
      { type: "mention", name: "Projects", path: "Bases/Projects.base" },
      { type: "mention", name: "Paper", path: "References/Paper.pdf" },
      { type: "mention", name: "Diagram", path: "Assets/Diagram.png" },
    ]);
  });

  it("deduplicates mentions by resolved path", () => {
    const text = "Read [[Alpha]], [[Alpha#Heading]], and [[Alias|A]].";
    const input = userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => (target === "Alpha" || target === "Alias" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null),
      [],
    );

    expect(input).toEqual([
      { type: "text", text },
      { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
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
      { type: "text", text },
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
      { type: "text", text },
      { type: "skill", name: "First", path: "/skills/first/SKILL.md" },
    ]);
  });
});

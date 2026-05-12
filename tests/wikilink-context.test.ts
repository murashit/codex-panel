import { describe, expect, it } from "vitest";

import { parsedWikiLinks, userInputWithWikiLinkMentions } from "../src/composer/wikilink-context";

describe("wikilink context", () => {
  it("parses aliases, subpaths, and duplicate links", () => {
    expect(parsedWikiLinks("See [[Alpha|label]], [[Beta#Heading]], [[Gamma^block]], and [[Alpha]].")).toEqual([
      { raw: "Alpha|label", target: "Alpha", subpath: "", display: "label" },
      { raw: "Beta#Heading", target: "Beta", subpath: "#Heading", display: "" },
      { raw: "Gamma^block", target: "Gamma", subpath: "^block", display: "" },
    ]);
  });

  it("adds mentions for resolved wikilinks without changing the visible prompt body", () => {
    const text = "Please compare [[Alpha|A]] and [[Missing]].";
    const input = userInputWithWikiLinkMentions(text, (target) =>
      target === "Alpha" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null,
    );

    expect(input).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
    ]);
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
});

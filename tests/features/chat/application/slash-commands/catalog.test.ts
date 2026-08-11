import { describe, expect, it } from "vitest";

import { slashCommandHelpSections } from "../../../../../src/features/chat/application/slash-commands/catalog";

describe("slash command catalog", () => {
  it("groups representative help rows by command surface", () => {
    const sections = slashCommandHelpSections();
    const keys = (title: string) => sections.find((section) => section.title === title)?.auditFacts.map((row) => row.key) ?? [];

    expect(sections.map((section) => section.title)).toEqual(["Panel actions", "Thread settings", "Diagnostics", "Composition"]);
    expect(keys("Panel actions")).toContain("/clear");
    expect(keys("Thread settings")).toContain("/goal set <objective>");
    expect(keys("Diagnostics")).toContain("/status");
    expect(keys("Composition")).toContain("/web <url> [message]");
  });
});

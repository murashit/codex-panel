// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { renderTextWithWikiLinks } from "../../../../src/shared/ui/dom";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("view DOM helpers", () => {
  it("renders wiki links and opens the target on click", () => {
    const parent = document.createElement("div");
    const openLink = vi.fn();

    renderTextWithWikiLinks(parent, "See [[Target Note#Heading|label]] and [[Other]].", openLink);

    const links = parent.querySelectorAll<HTMLAnchorElement>("a.internal-link");
    const firstLink = expectPresent(links[0]);
    expect(links).toHaveLength(2);
    expect(firstLink.textContent).toBe("label");
    expect(firstLink.getAttribute("href")).toBe("Target Note#Heading");

    firstLink.click();
    expect(openLink).toHaveBeenCalledWith("Target Note#Heading");
  });
});

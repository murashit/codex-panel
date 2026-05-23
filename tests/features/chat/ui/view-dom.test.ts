// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { renderTextWithWikiLinks, shortSignature } from "../../../../src/shared/ui/dom";
import { installObsidianDomShims } from "./dom-test-helpers";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("view DOM helpers", () => {
  it("uses short signatures instead of embedding full text in data attributes", () => {
    const long = "x".repeat(20_000);
    expect(shortSignature(long).length).toBeLessThan(12);
    expect(shortSignature(long)).toBe(shortSignature(long));
    expect(shortSignature(`${long}y`)).not.toBe(shortSignature(long));
  });

  it("renders wiki links and opens the target on click", () => {
    const parent = document.createElement("div");
    const openLink = vi.fn();

    renderTextWithWikiLinks(parent, "See [[Target Note|label]] and [[Other]].", openLink);

    const links = parent.querySelectorAll<HTMLAnchorElement>("a.internal-link");
    const firstLink = expectPresent(links[0]);
    expect(links).toHaveLength(2);
    expect(firstLink.textContent).toBe("label");
    expect(firstLink.getAttribute("href")).toBe("Target Note");

    firstLink.click();
    expect(openLink).toHaveBeenCalledWith("Target Note");
  });
});

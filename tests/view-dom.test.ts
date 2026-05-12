// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTextWithWikiLinks, shortSignature } from "../src/view/dom";

declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLElementTagNameMap[K];
  }
}

beforeEach(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text) element.textContent = options.text;
    for (const [key, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(key, value);
    }
    this.appendChild(element);
    return element;
  };
});

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
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe("label");
    expect(links[0].getAttribute("href")).toBe("Target Note");

    links[0].click();
    expect(openLink).toHaveBeenCalledWith("Target Note");
  });
});

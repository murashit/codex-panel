import { beforeEach, vi } from "vitest";

import { installObsidianElementHelpers, type ObsidianElementOptions } from "./obsidian-dom";

export function installObsidianDomShims(): void {
  beforeEach(() => {
    installObsidianElementHelpers();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    globalThis.createDiv = ((options: ObsidianElementOptions = {}) => document.body.createDiv(options)) as typeof globalThis.createDiv;
  });
}

export function topLevelDetailsSummaries(element: HTMLElement): (string | null)[] {
  const candidates = [element, ...element.children];
  return candidates
    .filter((child): child is HTMLDetailsElement => child instanceof HTMLDetailsElement)
    .map((details) => details.querySelector("summary")?.textContent ?? null);
}

export function changeInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (!valueDescriptor?.set) throw new Error("Missing input value setter");
  valueDescriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function composerSuggestionScrollFixture(metrics: {
  clientHeight: number;
  optionHeight: number;
  optionTop: number;
  scrollTop: number;
}): {
  container: HTMLElement;
  option: HTMLElement;
} {
  const container = document.createElement("div");
  const option = container.createDiv();

  Object.defineProperty(container, "clientHeight", { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(option, "offsetHeight", { value: metrics.optionHeight, configurable: true });
  Object.defineProperty(option, "offsetTop", { value: metrics.optionTop, configurable: true });
  container.scrollTop = metrics.scrollTop;

  return { container, option };
}

import { beforeEach, vi } from "vitest";

declare global {
  function createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;

  interface HTMLElement {
    addClass(className: string): void;
    createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLElementTagNameMap[K];
    createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLSpanElement;
    empty(): void;
    hide(): void;
    setCssProps(props: Record<string, string>): void;
    setAttr(name: string, value: string): void;
    show(): void;
  }
}

export function installObsidianDomShims(): void {
  beforeEach(() => {
    const NodeCtor = nodeConstructor();
    if (!Object.getOwnPropertyDescriptor(NodeCtor.prototype, "doc")) {
      Object.defineProperty(NodeCtor.prototype, "doc", {
        configurable: true,
        get(this: Node): Document {
          return this.ownerDocument ?? document;
        },
      });
    }
    if (!Object.getOwnPropertyDescriptor(NodeCtor.prototype, "win")) {
      Object.defineProperty(NodeCtor.prototype, "win", {
        configurable: true,
        get(this: Node): Window {
          return this.ownerDocument?.defaultView ?? window;
        },
      });
    }
    HTMLElement.prototype.addClass = function addClass(this: HTMLElement, className: string): void {
      this.classList.add(...className.split(/\s+/).filter(Boolean));
    };
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
    HTMLElement.prototype.createDiv = function createDiv(
      this: HTMLElement,
      options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
    ): HTMLDivElement {
      return this.createEl("div", options);
    };
    HTMLElement.prototype.createSpan = function createSpan(
      this: HTMLElement,
      options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
    ): HTMLSpanElement {
      return this.createEl("span", options);
    };
    HTMLElement.prototype.empty = function empty(this: HTMLElement): void {
      this.replaceChildren();
    };
    HTMLElement.prototype.hide = function hide(this: HTMLElement): void {
      this.style.display = "none";
    };
    HTMLElement.prototype.show = function show(this: HTMLElement): void {
      this.style.display = "";
    };
    HTMLElement.prototype.setAttr = function setAttr(this: HTMLElement, name: string, value: string): void {
      this.setAttribute(name, value);
    };
    HTMLElement.prototype.setCssProps = function setCssProps(this: HTMLElement, props: Record<string, string>): void {
      for (const [key, value] of Object.entries(props)) {
        this.style.setProperty(key, value);
      }
    };
    HTMLElement.prototype.scrollIntoView = vi.fn();
    globalThis.createDiv = ((options: { cls?: string; text?: string; attr?: Record<string, string> } = {}) =>
      document.body.createDiv(options)) as typeof globalThis.createDiv;
  });
}

function nodeConstructor(): typeof Node {
  const defaultView = document.defaultView;
  if (defaultView === null) throw new Error("Expected document.defaultView to install Obsidian DOM helpers.");
  return (globalThis as typeof globalThis & { Node?: typeof Node }).Node ?? defaultView.Node;
}

export function topLevelDetailsSummaries(element: HTMLElement): (string | null)[] {
  const candidates = [element, ...element.children];
  return candidates
    .filter((child): child is HTMLDetailsElement => child instanceof HTMLDetailsElement)
    .map((details) => details.querySelector("summary")?.textContent ?? null);
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

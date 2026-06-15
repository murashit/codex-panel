export interface ObsidianElementOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
}

declare global {
  function createDiv(options?: ObsidianElementOptions): HTMLDivElement;

  interface HTMLElement {
    addClass(className: string): void;
    createDiv(options?: ObsidianElementOptions): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ObsidianElementOptions): HTMLElementTagNameMap[K];
    createSpan(options?: ObsidianElementOptions): HTMLSpanElement;
    empty(): void;
    hide(): void;
    setCssProps(props: Record<string, string>): void;
    setAttr(name: string, value: string): void;
    show(): void;
  }
}

export function installObsidianElementHelpers(): void {
  if (typeof HTMLElement === "undefined") return;

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

  HTMLElement.prototype.addClass = function addClass(className: string): void {
    this.classList.add(...className.split(/\s+/).filter(Boolean));
  };
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: ObsidianElementOptions = {},
  ): HTMLElementTagNameMap[K] {
    const child = document.createElement(tag);
    applyOptions(child, options);
    this.append(child);
    return child;
  };
  HTMLElement.prototype.createDiv = function createDiv(options: ObsidianElementOptions = {}): HTMLDivElement {
    return this.createEl("div", options);
  };
  HTMLElement.prototype.createSpan = function createSpan(options: ObsidianElementOptions = {}): HTMLSpanElement {
    return this.createEl("span", options);
  };
  HTMLElement.prototype.empty = function empty(): void {
    this.replaceChildren();
  };
  HTMLElement.prototype.hide = function hide(): void {
    this.style.display = "none";
  };
  HTMLElement.prototype.show = function show(): void {
    this.style.display = "";
  };
  HTMLElement.prototype.setAttr = function setAttr(name: string, value: string): void {
    this.setAttribute(name, value);
  };
  HTMLElement.prototype.setCssProps = function setCssProps(props: Record<string, string>): void {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
}

function nodeConstructor(): typeof Node {
  const defaultView = document.defaultView;
  if (defaultView === null) throw new Error("Expected document.defaultView to install Obsidian DOM helpers.");
  return (globalThis as typeof globalThis & { Node?: typeof Node }).Node ?? defaultView.Node;
}

function applyOptions(element: HTMLElement, options: ObsidianElementOptions): void {
  if (Array.isArray(options.cls)) {
    element.classList.add(...options.cls.filter(Boolean));
  } else if (options.cls) {
    element.classList.add(...options.cls.split(/\s+/).filter(Boolean));
  }

  if (options.text !== undefined) {
    element.textContent = options.text;
  }

  for (const [name, value] of Object.entries(options.attr ?? {})) {
    element.setAttribute(name, value);
  }
}

interface ElementOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
}

declare global {
  interface HTMLElement {
    addClass(className: string): void;
    createDiv(options?: ElementOptions): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K];
    createSpan(options?: ElementOptions): HTMLSpanElement;
    empty(): void;
    setCssProps(props: Record<string, string>): void;
    setAttr(name: string, value: string): void;
  }
}

export type App = Record<string, never>;

export const notices: string[] = [];

export class FileSystemAdapter {
  constructor(readonly basePath: string) {}

  getBasePath(): string {
    return this.basePath;
  }
}

export class TFile {
  constructor(
    readonly path: string,
    readonly basename: string,
  ) {}
}

export class Notice {
  readonly message: string;

  constructor(message: string) {
    this.message = message;
    notices.push(message);
  }
}

export class PluginSettingTab {
  containerEl: HTMLElement;

  constructor(
    readonly app: App,
    readonly plugin: unknown,
  ) {
    ensureElementHelpers();
    this.containerEl = document.createElement("div");
  }

  display(): void {
    // Test mock placeholder.
  }
}

export class Setting {
  readonly settingEl: HTMLDivElement;
  readonly infoEl: HTMLDivElement;
  readonly controlEl: HTMLDivElement;
  descEl: HTMLDivElement;
  private nameEl: HTMLDivElement | null = null;

  constructor(containerEl: HTMLElement) {
    ensureElementHelpers();
    this.settingEl = containerEl.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }

  setName(name: string): this {
    this.nameEl?.remove();
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name", text: name });
    return this;
  }

  setDesc(desc: string): this {
    this.descEl.empty();
    this.descEl.textContent = desc;
    return this;
  }

  setClass(cls: string): this {
    this.settingEl.addClass(cls);
    return this;
  }

  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }

  addButton(callback: (button: ButtonComponent) => void): this {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }

  addExtraButton(callback: (button: ExtraButtonComponent) => void): this {
    callback(new ExtraButtonComponent(this.controlEl));
    return this;
  }

  addDropdown(callback: (dropdown: DropdownComponent) => void): this {
    callback(new DropdownComponent(this.controlEl));
    return this;
  }

  addText(callback: (text: TextComponent) => void): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  addToggle(callback: (toggle: ToggleComponent) => void): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }
}

class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl("button", { attr: { type: "button" } });
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }

  onClick(callback: () => void): this {
    this.buttonEl.onclick = callback;
    return this;
  }
}

class ExtraButtonComponent {
  readonly extraSettingsEl: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.extraSettingsEl = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button" } });
  }

  setDisabled(disabled: boolean): this {
    this.extraSettingsEl.disabled = disabled;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.extraSettingsEl.title = tooltip;
    return this;
  }

  setIcon(icon: string): this {
    setIcon(this.extraSettingsEl, icon);
    return this;
  }

  onClick(callback: () => void): this {
    this.extraSettingsEl.onclick = callback;
    return this;
  }
}

class DropdownComponent {
  readonly selectEl: HTMLSelectElement;

  constructor(parent: HTMLElement) {
    this.selectEl = parent.createEl("select");
  }

  addOption(value: string, label: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    this.selectEl.append(option);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void | Promise<void>): this {
    this.selectEl.onchange = () => {
      void callback(this.selectEl.value);
    };
    return this;
  }
}

class TextComponent {
  readonly inputEl: HTMLInputElement;

  constructor(parent: HTMLElement) {
    this.inputEl = parent.createEl("input");
  }

  setPlaceholder(value: string): this {
    this.inputEl.placeholder = value;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => void | Promise<void>): this {
    this.inputEl.onchange = () => {
      void callback(this.inputEl.value);
    };
    return this;
  }
}

class ToggleComponent {
  readonly toggleEl: HTMLInputElement;

  constructor(parent: HTMLElement) {
    this.toggleEl = parent.createEl("input", { attr: { type: "checkbox" } });
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }

  onChange(callback: (value: boolean) => void | Promise<void>): this {
    this.toggleEl.onchange = () => {
      void callback(this.toggleEl.checked);
    };
    return this;
  }
}

export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset["icon"] = icon;
}

function ensureElementHelpers(): void {
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
    this.classList.add(className);
  };

  HTMLElement.prototype.empty = function empty(): void {
    this.replaceChildren();
  };

  HTMLElement.prototype.setAttr = function setAttr(name: string, value: string): void {
    this.setAttribute(name, value);
  };

  HTMLElement.prototype.setCssProps = function setCssProps(props: Record<string, string>): void {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };

  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: ElementOptions = {},
  ): HTMLElementTagNameMap[K] {
    const child = document.createElement(tag);
    applyOptions(child, options);
    this.append(child);
    return child;
  };

  HTMLElement.prototype.createDiv = function createDiv(options: ElementOptions = {}): HTMLDivElement {
    return this.createEl("div", options);
  };

  HTMLElement.prototype.createSpan = function createSpan(options: ElementOptions = {}): HTMLSpanElement {
    return this.createEl("span", options);
  };
}

function nodeConstructor(): typeof Node {
  const defaultView = document.defaultView;
  if (defaultView === null) throw new Error("Expected document.defaultView to install Obsidian DOM helpers.");
  return (globalThis as typeof globalThis & { Node?: typeof Node }).Node ?? defaultView.Node;
}

function applyOptions(element: HTMLElement, options: ElementOptions): void {
  if (Array.isArray(options.cls)) {
    element.classList.add(...options.cls.filter(Boolean));
  } else if (options.cls) {
    element.className = options.cls;
  }

  if (options.text !== undefined) {
    element.textContent = options.text;
  }

  for (const [name, value] of Object.entries(options.attr ?? {})) {
    element.setAttribute(name, value);
  }
}

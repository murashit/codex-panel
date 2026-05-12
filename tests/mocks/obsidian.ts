type ElementOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
};

declare global {
  interface HTMLElement {
    addClass(className: string): void;
    createDiv(options?: ElementOptions): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K];
    createSpan(options?: ElementOptions): HTMLSpanElement;
    empty(): void;
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

export class Notice {
  constructor(message: string) {
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

export function setIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
}

function ensureElementHelpers(): void {
  if (typeof HTMLElement === "undefined") return;

  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function addClass(className: string): void {
      this.classList.add(className);
    };
  }

  if (!HTMLElement.prototype.empty) {
    HTMLElement.prototype.empty = function empty(): void {
      this.replaceChildren();
    };
  }

  if (!HTMLElement.prototype.setAttr) {
    HTMLElement.prototype.setAttr = function setAttr(name: string, value: string): void {
      this.setAttribute(name, value);
    };
  }

  if (!HTMLElement.prototype.createEl) {
    HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options: ElementOptions = {},
    ): HTMLElementTagNameMap[K] {
      const child = document.createElement(tag);
      applyOptions(child, options);
      this.append(child);
      return child;
    };
  }

  if (!HTMLElement.prototype.createDiv) {
    HTMLElement.prototype.createDiv = function createDiv(options: ElementOptions = {}): HTMLDivElement {
      return this.createEl("div", options);
    };
  }

  if (!HTMLElement.prototype.createSpan) {
    HTMLElement.prototype.createSpan = function createSpan(options: ElementOptions = {}): HTMLSpanElement {
      return this.createEl("span", options);
    };
  }
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

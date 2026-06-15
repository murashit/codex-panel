import { installObsidianElementHelpers } from "../support/obsidian-dom";

export type App = Record<string, never>;

export const notices: string[] = [];

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: true,
  isWin: false,
  isLinux: false,
};

export class FileSystemAdapter {
  constructor(readonly basePath = "") {}

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

export function prepareFuzzySearch(query: string): (text: string) => { score: number; matches: unknown[] } | null {
  const normalizedQuery = query.toLowerCase();
  return (text: string) => {
    const normalizedText = text.toLowerCase();
    if (normalizedQuery.length === 0) return { score: 0, matches: [] };

    const startsAt = normalizedText.indexOf(normalizedQuery);
    if (startsAt !== -1) {
      return { score: 10_000 - startsAt * 10 - normalizedText.length, matches: [[startsAt, startsAt + normalizedQuery.length]] };
    }

    let textIndex = 0;
    let firstMatch = -1;
    let lastMatch = -1;
    for (const char of normalizedQuery) {
      const foundAt = normalizedText.indexOf(char, textIndex);
      if (foundAt === -1) return null;
      if (firstMatch === -1) firstMatch = foundAt;
      lastMatch = foundAt;
      textIndex = foundAt + 1;
    }

    const spread = lastMatch - firstMatch;
    return { score: 5_000 - firstMatch * 10 - spread - normalizedText.length, matches: [] };
  };
}

export function sortSearchResults(results: { match: { score: number } }[]): void {
  results.sort((a, b) => b.match.score - a.match.score);
}

export function stripHeadingForLink(heading: string): string {
  return heading.trim();
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const headingIndex = linktext.indexOf("#");
  const blockIndex = linktext.indexOf("^");
  const subpathStart = headingIndex === -1 ? blockIndex : blockIndex === -1 ? headingIndex : Math.min(headingIndex, blockIndex);
  return subpathStart === -1
    ? { path: linktext, subpath: "" }
    : { path: linktext.slice(0, subpathStart), subpath: linktext.slice(subpathStart) };
}

export class Modal {
  readonly contentEl: HTMLElement;

  constructor(readonly app: App) {
    ensureElementHelpers();
    this.contentEl = document.createElement("div");
  }

  open(): void {
    void this.onOpen();
  }

  close(): void {
    this.onClose();
  }

  onOpen(): Promise<void> | void {
    // Test mock placeholder.
  }

  onClose(): void {
    // Test mock placeholder.
  }
}

export abstract class SuggestModal<T> extends Modal {
  limit = 100;
  emptyStateText = "";
  readonly inputEl: HTMLInputElement;
  readonly resultContainerEl: HTMLElement;

  constructor(app: App) {
    super(app);
    this.inputEl = document.createElement("input");
    this.resultContainerEl = document.createElement("div");
  }

  setPlaceholder(placeholder: string): void {
    this.inputEl.placeholder = placeholder;
  }

  setInstructions(_instructions: { command: string; purpose: string }[]): void {
    // Test mock placeholder.
  }

  selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void {
    const suggestions = this.getSuggestions(this.inputEl.value);
    if (!Array.isArray(suggestions)) return;
    const suggestion = suggestions.at(0);
    if (suggestion) this.onChooseSuggestion(suggestion, evt);
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}

export class ItemView {
  readonly app: App;
  readonly contentEl: HTMLElement;
  readonly containerEl: HTMLElement;

  constructor(readonly leaf: { app?: App; containerEl?: HTMLElement }) {
    ensureElementHelpers();
    this.app = leaf.app ?? {};
    this.containerEl = leaf.containerEl ?? document.createElement("div");
    this.contentEl = this.containerEl.createDiv();
  }

  registerDomEvent<K extends keyof DocumentEventMap>(element: Document, type: K, callback: (event: DocumentEventMap[K]) => void): void {
    element.addEventListener(type, callback);
  }

  registerEvent(_eventRef: unknown): void {
    // Test mock placeholder.
  }

  getState(): Record<string, unknown> {
    return {};
  }

  setState(_state: unknown, _result: unknown): Promise<void> {
    return Promise.resolve();
  }

  onClose(): Promise<void> | void {
    // Test mock placeholder.
  }
}

export class MarkdownView {
  file: TFile | null = null;
}

export class Plugin {
  constructor(readonly app: App) {}

  register(_callback: () => void): void {
    // Test mock placeholder.
  }

  registerEvent(_eventRef: unknown): void {
    // Test mock placeholder.
  }

  addCommand(_command: unknown): void {
    // Test mock placeholder.
  }

  addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {
    // Test mock placeholder.
  }

  addSettingTab(_tab: unknown): void {
    // Test mock placeholder.
  }

  registerView(_type: string, _factory: unknown): void {
    // Test mock placeholder.
  }

  loadData(): Promise<unknown> {
    return Promise.resolve(null);
  }

  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export const MarkdownRenderer = {
  render(_app: unknown, text: string, parent: HTMLElement): Promise<void> {
    parent.textContent = text;
    return Promise.resolve();
  },
};

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

  hide(): void {
    this.containerEl.empty();
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
  installObsidianElementHelpers();
}

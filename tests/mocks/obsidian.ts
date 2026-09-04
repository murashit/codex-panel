import Moment from "moment";

import { installObsidianElementHelpers } from "../support/obsidian-dom";

export type App = Record<string, never>;

export const notices: string[] = [];

export const moment = Moment;

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
  path: string;
  basename: string;
  name: string;
  extension: string;

  constructor(path = "", basename = "") {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    const dotIndex = this.name.lastIndexOf(".");
    this.extension = dotIndex === -1 ? "" : this.name.slice(dotIndex + 1);
    this.basename = basename || (dotIndex === -1 ? this.name : this.name.slice(0, dotIndex));
  }
}

export class Notice {
  readonly message: string;

  constructor(message: string) {
    this.message = message;
    notices.push(message);
  }
}

export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string {
  return typeof html === "string" ? html : "";
}

export async function requestUrl(_request: unknown): Promise<{ status: number; text: string }> {
  return { status: 200, text: "" };
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

export function getAllTags(cache: { tags?: { tag: string }[]; frontmatter?: { tags?: unknown } }): string[] | null {
  const tags = [...(cache.tags?.map((tag) => tag.tag) ?? []), ...frontmatterTags(cache.frontmatter?.tags)];
  return tags.length > 0 ? tags : null;
}

function frontmatterTags(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string");
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const headingIndex = linktext.indexOf("#");
  const blockIndex = linktext.indexOf("^");
  const subpathStart = headingIndex === -1 ? blockIndex : blockIndex === -1 ? headingIndex : Math.min(headingIndex, blockIndex);
  return subpathStart === -1
    ? { path: linktext, subpath: "" }
    : { path: linktext.slice(0, subpathStart), subpath: linktext.slice(subpathStart) };
}

export function normalizePath(path: string): string {
  return path
    .replace(/\u00a0/g, " ")
    .replace(/[\\/]+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .normalize();
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

  onNoSuggestion(): void {
    this.resultContainerEl.textContent = this.emptyStateText;
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

export class Component {
  private readonly cleanups: (() => void)[] = [];
  private loaded = false;

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.onload();
  }

  onload(): void {}

  onunload(): void {}

  addChild(_child: Component): void {}

  removeChild(child: Component): void {
    child.unload();
  }

  registerDomEvent<K extends keyof DocumentEventMap>(element: Document, type: K, callback: (event: DocumentEventMap[K]) => void): void {
    element.addEventListener(type, callback);
    this.cleanups.push(() => element.removeEventListener(type, callback));
  }

  registerEvent(eventRef: unknown): void {
    const cleanup = (eventRef as { __obsidianMockCleanup?: unknown } | null)?.__obsidianMockCleanup;
    if (typeof cleanup === "function") this.cleanups.push(cleanup as () => void);
  }

  unload(): void {
    if (!this.loaded) return;
    this.loaded = false;
    this.onunload();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

export class ItemView extends Component {
  readonly app: App;
  readonly contentEl: HTMLElement;
  readonly containerEl: HTMLElement;

  constructor(readonly leaf: { app?: App; containerEl?: HTMLElement }) {
    super();
    ensureElementHelpers();
    this.app = leaf.app ?? {};
    this.containerEl = leaf.containerEl ?? document.createElement("div");
    this.contentEl = this.containerEl.createDiv();
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

  registerEditorExtension(_extension: unknown): void {
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

  saveData(_storedValue: unknown): Promise<void> {
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
  private settingCleanups: (() => void)[] = [];

  constructor(
    readonly app: App,
    readonly plugin: unknown,
  ) {
    ensureElementHelpers();
    this.containerEl = document.createElement("div");
  }

  display(): void {
    this.clearSettings();
    const definitions = (this as unknown as { getSettingDefinitions?: () => MockSettingDefinitionItem[] }).getSettingDefinitions?.() ?? [];
    renderSettingDefinitions(this, this.containerEl, definitions, this.settingCleanups);
  }

  hide(): void {
    this.clearSettings();
  }

  private clearSettings(): void {
    for (const cleanup of this.settingCleanups.splice(0)) cleanup();
    this.containerEl.empty();
  }
}

interface MockSettingDefinition {
  name: string;
  desc?: string;
  render?: (setting: Setting, group: unknown) => undefined | (() => void);
  control?: { type: "toggle"; key: string } | { type: "dropdown"; key: string; defaultValue?: string; options: Record<string, string> };
}

interface MockSettingDefinitionGroup {
  type: "group";
  heading?: string;
  cls?: string;
  items?: MockSettingDefinition[];
}

type MockSettingDefinitionItem = MockSettingDefinition | MockSettingDefinitionGroup;

function renderSettingDefinitions(
  tab: PluginSettingTab,
  container: HTMLElement,
  definitions: MockSettingDefinitionItem[],
  cleanups: (() => void)[],
): void {
  for (const definition of definitions) {
    if ("type" in definition) {
      const group = definition.cls ? container.createDiv({ cls: definition.cls }) : container.createDiv();
      if (definition.heading) new Setting(group).setName(definition.heading).setHeading();
      const items = group.createDiv({ cls: "setting-items" });
      renderSettingDefinitions(tab, items, definition.items ?? [], cleanups);
      continue;
    }

    const setting = new Setting(container).setName(definition.name);
    if (definition.desc) setting.setDesc(definition.desc);
    const cleanup = definition.render?.(setting, {});
    if (cleanup) cleanups.push(cleanup);
    if (!definition.control) continue;

    const host = tab as unknown as {
      getControlValue: (key: string) => unknown;
      setControlValue: (key: string, value: unknown) => void | Promise<void>;
    };
    if (definition.control.type === "toggle") {
      setting.addToggle((toggle) => {
        toggle.setValue(host.getControlValue(definition.control?.key ?? "") === true).onChange(async (value) => {
          const key = definition.control?.key ?? "";
          await host.setControlValue(key, value);
          toggle.setValue(host.getControlValue(key) === true);
        });
      });
      continue;
    }
    setting.addDropdown((dropdown) => {
      const control = definition.control;
      if (control?.type !== "dropdown") return;
      for (const [value, label] of Object.entries(control.options)) dropdown.addOption(value, label);
      dropdown.setValue(String(host.getControlValue(control.key) ?? control.defaultValue ?? "")).onChange(async (value) => {
        await host.setControlValue(control.key, value);
        dropdown.setValue(String(host.getControlValue(control.key) ?? control.defaultValue ?? ""));
      });
    });
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

export class ButtonComponent {
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

export class ExtraButtonComponent {
  readonly extraSettingsEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.extraSettingsEl = parent.createDiv({ cls: "clickable-icon extra-setting-button" });
    this.extraSettingsEl.tabIndex = 0;
  }

  setDisabled(disabled: boolean): this {
    this.extraSettingsEl.classList.toggle("is-disabled", disabled);
    this.extraSettingsEl.ariaDisabled = String(disabled);
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

export class DropdownComponent {
  readonly selectEl: HTMLSelectElement;

  constructor(parent: HTMLElement) {
    this.selectEl = parent.createEl("select");
    this.selectEl.addClass("dropdown");
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

export class TextComponent {
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

export class ToggleComponent {
  readonly toggleEl: HTMLInputElement;
  private readonly containerEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.containerEl = parent.createDiv({ cls: "checkbox-container" });
    this.toggleEl = this.containerEl.createEl("input", { attr: { type: "checkbox" } });
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    this.containerEl.classList.toggle("is-enabled", value);
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

import { Component, ItemView, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS } from "../../constants";
import { createObsidianArchiveExportDestination } from "../threads/obsidian/archive-export-destination.obsidian";
import { type ThreadsViewHost, ThreadsViewSession } from "./session";

export interface ThreadsRuntimeView {
  attachRuntime(host: ThreadsViewHost): void;
  activateRuntime(): void;
  detachRuntime(): void;
}

export interface ThreadsViewRuntimeOwner {
  attachThreadsView(view: ThreadsRuntimeView): void;
  detachThreadsView(view: ThreadsRuntimeView): void;
}

export class CodexThreadsView extends ItemView {
  private session: ThreadsViewSession | null = null;
  private sessionOwner: Component | null = null;
  private opened = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly runtimeOwner: ThreadsViewRuntimeOwner,
  ) {
    super(leaf);
    this.runtimeOwner.attachThreadsView(this);
  }

  attachRuntime(plugin: ThreadsViewHost): void {
    if (this.session) throw new Error("Codex threads view is already attached to an execution runtime.");
    const owner = new Component();
    this.addChild(owner);
    const session = new ThreadsViewSession({
      root: this.containerEl,
      host: plugin,
      registerPointerDown: (handler) => {
        owner.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
      },
      archiveDestination: () => createObsidianArchiveExportDestination(this.app.vault),
      vaultConfigDir: () => this.app.vault.configDir,
      viewWindow: () => this.containerEl.doc.defaultView,
    });
    this.sessionOwner = owner;
    this.session = session;
  }

  activateRuntime(): void {
    if (this.opened) this.currentSession().open();
  }

  detachRuntime(): void {
    if (!this.session) return;
    this.session.close();
    this.session = null;
    if (this.sessionOwner) this.removeChild(this.sessionOwner);
    this.sessionOwner = null;
  }

  private currentSession(): ThreadsViewSession {
    if (!this.session) throw new Error("Codex threads view is not attached to an execution runtime.");
    return this.session;
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_THREADS;
  }

  override getDisplayText(): string {
    return "Codex threads";
  }

  override getIcon(): string {
    return "list-video";
  }

  override async onOpen(): Promise<void> {
    this.opened = true;
    this.currentSession().open();
  }

  override async onClose(): Promise<void> {
    this.opened = false;
    this.runtimeOwner.detachThreadsView(this);
  }

  refresh(): Promise<void> {
    return this.session?.refresh() ?? Promise.resolve();
  }

  refreshLiveState(): void {
    this.session?.refreshLiveState();
  }

  refreshSettings(): void {
    this.session?.refreshSettings();
  }
}

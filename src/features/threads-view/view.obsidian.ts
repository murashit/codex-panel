import { Component, ItemView, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS } from "../../constants";
import { type ThreadsViewHost, ThreadsViewSession } from "./session";

export interface ThreadsRuntimeView {
  attachRuntime(host: ThreadsViewHost): void;
  detachRuntime(): void;
}

export interface ThreadsViewRuntimeOwner {
  attachThreadsView(view: ThreadsRuntimeView): void;
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
    let session: ThreadsViewSession | null = null;
    try {
      this.addChild(owner);
      session = new ThreadsViewSession({
        root: this.containerEl,
        host: plugin,
        registerPointerDown: (handler) => {
          owner.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
        },
        viewWindow: () => this.containerEl.doc.defaultView,
      });
      this.sessionOwner = owner;
      this.session = session;
      if (this.opened) session.open();
    } catch {
      this.session = null;
      this.sessionOwner = null;
      try {
        session?.close();
      } catch {
        // Preserve the attach error; the view remains detached for a later reload.
      }
      try {
        this.removeChild(owner);
      } catch {
        // Leave the view detached for a later reload.
      }
    }
  }

  detachRuntime(): void {
    const session = this.session;
    if (!session) return;
    try {
      session.close();
    } catch {
      // The session is detached even when its cleanup reports an error.
    }
    this.session = null;
    const owner = this.sessionOwner;
    this.sessionOwner = null;
    try {
      if (owner) this.removeChild(owner);
    } catch {
      // The session is already detached; leave DOM cleanup to the owner lifecycle.
    }
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
    this.session?.open();
  }

  override async onClose(): Promise<void> {
    this.opened = false;
    this.detachRuntime();
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

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
  private attachment: { session: ThreadsViewSession; owner: Component } | null = null;
  private opened = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly runtimeOwner: ThreadsViewRuntimeOwner,
  ) {
    super(leaf);
    this.runtimeOwner.attachThreadsView(this);
  }

  attachRuntime(plugin: ThreadsViewHost): void {
    if (this.attachment) throw new Error("Codex threads view is already attached to an execution runtime.");
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
      this.attachment = { session, owner };
      if (this.opened) session.open();
    } catch {
      this.attachment = null;
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
    const attachment = this.attachment;
    if (!attachment) return;
    const { session, owner } = attachment;
    try {
      session.close();
    } catch {
      // The session is detached even when its cleanup reports an error.
    }
    this.attachment = null;
    try {
      this.removeChild(owner);
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
    this.attachment?.session.open();
  }

  override async onClose(): Promise<void> {
    this.opened = false;
    this.detachRuntime();
  }

  refresh(): Promise<void> {
    return this.attachment?.session.refresh() ?? Promise.resolve();
  }

  refreshLiveState(): void {
    this.attachment?.session.refreshLiveState();
  }

  refreshSettings(): void {
    this.attachment?.session.refreshSettings();
  }
}

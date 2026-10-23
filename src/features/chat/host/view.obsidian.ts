import { Component, ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../../../constants";
import type { ComposerRuntimeSnapshot } from "../application/composer/runtime-snapshot";
import { createLocalIdSource } from "../application/local-id-source";
import type { ChatPanelHandle, ChatPanelRuntimeSnapshot, ChatViewRuntimeOwner, CodexChatHost } from "./contracts";
import { ChatPanelSession } from "./session/session";

export class CodexChatView extends ItemView {
  private attachment: { session: ChatPanelSession; owner: Component } | null = null;
  private runtimeSnapshot: ChatPanelRuntimeSnapshot | null = null;
  private opened = false;
  private readonly viewId = createLocalIdSource().next("codex-panel");

  constructor(
    leaf: WorkspaceLeaf,
    private readonly runtimeOwner: ChatViewRuntimeOwner,
  ) {
    super(leaf);
    this.runtimeOwner.attachChatView(this);
  }

  get surface(): ChatPanelHandle {
    if (!this.attachment) throw new Error("Codex chat view is not attached to an execution runtime.");
    return this.attachment.session;
  }

  isRuntimeAttached(): boolean {
    return this.attachment !== null;
  }

  attachRuntime(plugin: CodexChatHost): void {
    if (this.attachment) throw new Error("Codex chat view is already attached to an execution runtime.");
    const owner = new Component();
    let session: ChatPanelSession | null = null;
    try {
      this.addChild(owner);
      session = new ChatPanelSession(
        {
          obsidian: {
            app: this.app,
            owner,
            viewId: this.viewId,
            registerEvent: (eventRef) => {
              owner.registerEvent(eventRef);
            },
            registerPointerDown: (handler) => {
              owner.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
            },
            requestWorkspaceLayoutSave: () => {
              void this.app.workspace.requestSaveLayout();
            },
            isForeground: () => this.app.workspace.getActiveViewOfType(CodexChatView) === this,
          },
          plugin,
          view: {
            panelRoot: () => this.contentEl,
            viewWindow: () => this.containerEl.doc.defaultView,
            refreshTabHeader: () => {
              this.refreshTabHeader();
            },
          },
        },
        this.runtimeSnapshot,
      );
      this.attachment = { session, owner };
      if (this.opened) session.open();
      this.runtimeSnapshot = null;
    } catch {
      this.attachment = null;
      if (session) void session.close().catch(() => undefined);
      try {
        this.removeChild(owner);
      } catch {
        // Leave the view detached for a later reload.
      }
    }
  }

  detachRuntime(): Promise<void> {
    const attachment = this.attachment;
    if (!attachment) return Promise.resolve();
    const { session, owner } = attachment;
    try {
      this.runtimeSnapshot = session.runtimeSnapshot();
    } catch {
      // Preserve the previous snapshot if collecting the latest one fails.
    }
    this.attachment = null;
    const cleanup = session.close().catch(() => undefined);
    try {
      this.removeChild(owner);
    } catch {
      // The session is already detached; leave DOM cleanup to the owner lifecycle.
    }
    return cleanup;
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_PANEL;
  }

  override getDisplayText(): string {
    if (this.attachment) return this.attachment.session.displayTitle();
    if (this.runtimeSnapshot?.forkDraft) return "Fork draft";
    const title = this.detachedViewState()["threadTitle"];
    return typeof title === "string" ? title : "Codex";
  }

  override getIcon(): string {
    return "bot-message-square";
  }

  override getState(): Record<string, unknown> {
    return this.attachment?.session.persistedState() ?? this.detachedViewState();
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (this.attachment) {
      this.attachment.session.applyViewState(state);
      return;
    }
    this.runtimeSnapshot = {
      viewState: typeof state === "object" && state !== null ? { ...(state as Record<string, unknown>) } : { version: 1 },
      composer: this.runtimeSnapshot?.composer ?? emptyComposerRuntimeSnapshot(),
      forkDraft: null,
    };
  }

  override async onOpen(): Promise<void> {
    this.opened = true;
    this.attachment?.session.open();
  }

  override async onClose(): Promise<void> {
    this.opened = false;
    await this.detachRuntime();
  }

  private refreshTabHeader(): void {
    const leaf = this.leaf as WorkspaceLeaf & {
      updateHeader?: () => void;
      updateDisplay?: () => void;
    };
    if (typeof leaf.updateHeader === "function") {
      leaf.updateHeader();
    } else if (typeof leaf.updateDisplay === "function") {
      leaf.updateDisplay();
    }
  }

  private detachedViewState(): Record<string, unknown> {
    return this.runtimeSnapshot?.viewState ?? { version: 1 };
  }
}

function emptyComposerRuntimeSnapshot(): ComposerRuntimeSnapshot {
  return {
    draft: "",
    attachments: [],
    activeNoteSnapshots: [],
    selectionSnapshots: [],
    threadCommandTarget: null,
  };
}

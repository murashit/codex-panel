import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../../../constants";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { Thread } from "../../../domain/threads/model";
import type { OpenCodexPanelSnapshot } from "../../../workspace/open-panel-snapshot";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { CodexChatHost } from "../application/ports/chat-host";
import { ChatPanelSession } from "./session";

export class CodexChatView extends ItemView {
  private readonly session: ChatPanelSession;
  private readonly viewId = `codex-panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  constructor(leaf: WorkspaceLeaf, plugin: CodexChatHost) {
    super(leaf);
    this.session = new ChatPanelSession({
      obsidian: {
        app: this.app,
        owner: this,
        viewId: this.viewId,
        registerEvent: (eventRef) => {
          this.registerEvent(eventRef);
        },
        registerPointerDown: (handler) => {
          this.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
        },
        archiveAdapter: () => this.app.vault.adapter,
        requestWorkspaceLayoutSave: () => {
          void this.app.workspace.requestSaveLayout();
        },
      },
      plugin,
      view: {
        panelRoot: () => this.contentEl,
        viewWindow: () => this.containerEl.doc.defaultView,
        containsElement: (element) => this.containerEl.contains(element),
        refreshTabHeader: () => {
          this.refreshTabHeader();
        },
      },
    });
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_PANEL;
  }

  override getDisplayText(): string {
    return this.session.displayTitle();
  }

  override getIcon(): string {
    return "bot-message-square";
  }

  override getState(): Record<string, unknown> {
    return this.session.persistedState();
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.session.applyViewState(state);
  }

  override async onOpen(): Promise<void> {
    this.session.open();
  }

  override async onClose(): Promise<void> {
    this.session.close();
  }

  refreshSettings(): void {
    this.session.refreshSettings();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.session.refreshSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.session.applyThreadListSnapshot(threads);
  }

  applyAppServerMetadataSnapshot(metadata: SharedServerMetadata): void {
    this.session.applyAppServerMetadataSnapshot(metadata);
  }

  applyAvailableModelsSnapshot(models: readonly ModelMetadata[]): void {
    this.session.applyAvailableModelsSnapshot(models);
  }

  openPanelSnapshot(): OpenCodexPanelSnapshot {
    return this.session.openPanelSnapshot();
  }

  openThread(threadId: string): Promise<void> {
    return this.session.openThread(threadId);
  }

  focusThread(threadId: string | null = null): Promise<void> {
    return this.session.focusThread(threadId);
  }

  focusComposer(): void {
    this.session.focusComposer();
  }

  notifyThreadArchived(threadId: string): void {
    this.session.notifyThreadArchived(threadId);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.session.notifyThreadRenamed(threadId, name);
  }

  setComposerText(text: string): void {
    this.session.setComposerText(text);
  }

  connect(): Promise<void> {
    return this.session.connect();
  }

  startNewThread(): Promise<void> {
    return this.session.startNewThread();
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
}

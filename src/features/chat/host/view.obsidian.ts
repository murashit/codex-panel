import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_PANEL } from "../../../constants";
import { createObsidianArchiveExportDestination } from "../../threads/obsidian/archive-export-destination.obsidian";
import { createLocalIdSource } from "../application/local-id-source";
import type { ChatPanelHandle, CodexChatHost } from "./contracts";
import { ChatPanelSession } from "./session";

export class CodexChatView extends ItemView {
  readonly surface: ChatPanelHandle;
  private readonly viewId = createLocalIdSource().next("codex-panel");

  constructor(leaf: WorkspaceLeaf, plugin: CodexChatHost) {
    super(leaf);
    this.surface = new ChatPanelSession({
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
        archiveDestination: () => createObsidianArchiveExportDestination(this.app.vault),
        requestWorkspaceLayoutSave: () => {
          void this.app.workspace.requestSaveLayout();
        },
      },
      plugin,
      view: {
        panelRoot: () => this.contentEl,
        viewWindow: () => this.containerEl.doc.defaultView,
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
    return this.surface.displayTitle();
  }

  override getIcon(): string {
    return "bot-message-square";
  }

  override getState(): Record<string, unknown> {
    return this.surface.persistedState();
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.surface.applyViewState(state);
  }

  override async onOpen(): Promise<void> {
    this.surface.open();
  }

  override async onClose(): Promise<void> {
    this.surface.close();
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

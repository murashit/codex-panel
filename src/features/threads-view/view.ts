import { ItemView, type WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS } from "../../constants";
import { CodexThreadsSession, type CodexThreadsHost } from "./session";

export type { CodexThreadsHost, CodexThreadsSettingsAccess } from "./session";

export class CodexThreadsView extends ItemView {
  private readonly session: CodexThreadsSession;

  constructor(leaf: WorkspaceLeaf, plugin: CodexThreadsHost) {
    super(leaf);
    this.session = new CodexThreadsSession({
      root: this.containerEl,
      host: plugin,
      registerPointerDown: (handler) => {
        this.registerDomEvent(this.containerEl.doc, "pointerdown", handler);
      },
      archiveAdapter: () => this.app.vault.adapter,
      vaultConfigDir: () => this.app.vault.configDir,
      viewWindow: () => this.containerEl.doc.defaultView,
    });
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
    this.session.open();
  }

  override async onClose(): Promise<void> {
    this.session.close();
  }

  refresh(): Promise<void> {
    return this.session.refresh();
  }

  refreshLiveState(): void {
    this.session.refreshLiveState();
  }
}

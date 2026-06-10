import type { ComponentChild as UiNode } from "preact";
import { renderUiRoot, unmountUiRoot } from "../../../shared/ui/ui-root";
import type { ChatStateStore } from "../chat-state";

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  showToolbar: boolean;
  toolbarNode: () => UiNode;
  goalNode: () => UiNode;
  messagesNode: () => UiNode;
  composerNode: () => UiNode;
}

interface ChatPanelShellMount {
  props: ChatPanelShellProps;
  stateStore: ChatStateStore;
  unsubscribe: () => void;
  stopStatusBarClearanceSync: () => void;
  stateVersion: number;
}

const shellMounts = new WeakMap<HTMLElement, ChatPanelShellMount>();

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  container.addClass("codex-panel");
  const existing = shellMounts.get(container);
  const mount = existing?.stateStore === props.stateStore ? existing : createShellMount(container, props);
  mount.props = props;
  renderMountedShell(container, mount);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  const mount = shellMounts.get(container);
  mount?.unsubscribe();
  mount?.stopStatusBarClearanceSync();
  shellMounts.delete(container);
  unmountUiRoot(container);
  container.replaceChildren();
}

function createShellMount(container: HTMLElement, props: ChatPanelShellProps): ChatPanelShellMount {
  const existing = shellMounts.get(container);
  existing?.unsubscribe();
  existing?.stopStatusBarClearanceSync();
  const mount: ChatPanelShellMount = {
    props,
    stateStore: props.stateStore,
    stateVersion: 0,
    unsubscribe: props.stateStore.subscribe(() => {
      const current = shellMounts.get(container);
      if (!current) return;
      current.stateVersion += 1;
      renderMountedShell(container, current);
    }),
    stopStatusBarClearanceSync: startStatusBarClearanceSync(container),
  };
  shellMounts.set(container, mount);
  return mount;
}

function renderMountedShell(container: HTMLElement, mount: ChatPanelShellMount): void {
  if (!uiRootIntact(container)) {
    unmountUiRoot(container);
    container.replaceChildren();
  }
  syncStatusBarClearance(container);
  renderUiRoot(container, <ChatPanelShell {...mount.props} stateVersion={mount.stateVersion} />);
}

function uiRootIntact(container: HTMLElement): boolean {
  const body = container.querySelector<HTMLElement>(":scope > .codex-panel__body");
  if (!body) return false;
  return Boolean(
    body.querySelector<HTMLElement>(":scope > .codex-panel__region--goal") &&
    body.querySelector<HTMLElement>(":scope > .codex-panel__messages") &&
    body.querySelector<HTMLElement>(":scope > .codex-panel__region--composer"),
  );
}

function ChatPanelShell({
  showToolbar,
  toolbarNode,
  goalNode,
  messagesNode,
  composerNode,
  stateVersion,
}: ChatPanelShellProps & { stateVersion: number }): UiNode {
  return (
    <>
      {showToolbar ? <div className="codex-panel__toolbar">{toolbarNode()}</div> : null}
      <div className="codex-panel__body" data-codex-panel-state-version={String(stateVersion)}>
        <div className="codex-panel__region codex-panel__region--goal">{goalNode()}</div>
        {messagesNode()}
        <div className="codex-panel__region codex-panel__region--composer">{composerNode()}</div>
      </div>
    </>
  );
}

function startStatusBarClearanceSync(container: HTMLElement): () => void {
  const win = container.ownerDocument.defaultView;
  if (!win) return () => undefined;

  const cleanupCallbacks: (() => void)[] = [];
  let observedStatusBar: HTMLElement | null = null;
  let statusBarMutationObserver: MutationObserver | null = null;
  let statusBarResizeObserver: ResizeObserver | null = null;

  const observeStatusBar = (): void => {
    const statusBar = container.ownerDocument.querySelector<HTMLElement>(".status-bar");
    if (statusBar === observedStatusBar) return;
    statusBarMutationObserver?.disconnect();
    statusBarResizeObserver?.disconnect();
    statusBarMutationObserver = null;
    statusBarResizeObserver = null;
    observedStatusBar = statusBar;
    if (!statusBar) return;

    statusBarMutationObserver = new win.MutationObserver(() => {
      syncStatusBarClearance(container);
    });
    statusBarMutationObserver.observe(statusBar, { attributes: true, attributeFilter: ["class", "style"] });

    const ResizeObserverCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (ResizeObserverCtor) {
      statusBarResizeObserver = new ResizeObserverCtor(() => {
        syncStatusBarClearance(container);
      });
      statusBarResizeObserver.observe(statusBar);
    }
  };

  const sync = (): void => {
    observeStatusBar();
    syncStatusBarClearance(container);
  };

  const bodyObserver = new win.MutationObserver(sync);
  bodyObserver.observe(container.ownerDocument.body, { attributes: true, attributeFilter: ["class", "style"], childList: true });
  cleanupCallbacks.push(() => {
    bodyObserver.disconnect();
  });

  win.addEventListener("resize", sync);
  cleanupCallbacks.push(() => {
    win.removeEventListener("resize", sync);
  });
  sync();

  return () => {
    for (const cleanup of cleanupCallbacks) cleanup();
    statusBarMutationObserver?.disconnect();
    statusBarResizeObserver?.disconnect();
  };
}

function syncStatusBarClearance(container: HTMLElement): void {
  container.style.setProperty("--codex-panel-status-bar-clearance", `${String(statusBarClearance(container))}px`);
}

function statusBarClearance(container: HTMLElement): number {
  const win = container.ownerDocument.defaultView;
  const statusBar = container.ownerDocument.querySelector<HTMLElement>(".status-bar");
  if (!win || !statusBar) return 0;
  const style = win.getComputedStyle(statusBar);
  if (style.display === "none" || style.visibility === "hidden" || style.position !== "fixed") return 0;
  const rectHeight = statusBar.getBoundingClientRect().height;
  if (Number.isFinite(rectHeight) && rectHeight > 0) return Math.ceil(rectHeight);
  const computedHeight = Number.parseFloat(style.height);
  return Number.isFinite(computedHeight) && computedHeight > 0 ? Math.ceil(computedHeight) : 0;
}

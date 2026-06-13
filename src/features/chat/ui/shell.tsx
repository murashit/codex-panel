import type { ComponentChild as UiNode } from "preact";
import { renderUiRoot, unmountUiRoot } from "../../../shared/ui/ui-root";
import type { ChatStateStore } from "../state/reducer";
import type { ChatPanelGoalSurface, ChatPanelToolbarSurface } from "../panel/surface/model";
import { ChatPanelToolbar } from "../panel/surface/toolbar";
import { ChatPanelGoal } from "../panel/surface/goal";
import { ChatPanelMessageStream, type ChatPanelMessageStreamPresenter } from "../panel/surface/message-stream";
import { ChatPanelComposer, type ChatPanelComposerController } from "../panel/surface/composer";
import { ChatPanelShellStateContext, createChatPanelShellState, syncChatPanelShellState, type ChatPanelShellState } from "./shell-state";

export interface ChatPanelShellParts {
  toolbar: ChatPanelToolbarSurface;
  goal: ChatPanelGoalSurface;
  messageStream: ChatPanelMessageStreamPresenter;
  composer: ChatPanelComposerController;
}

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  showToolbar: boolean;
  parts: ChatPanelShellParts;
}

interface ChatPanelShellMount {
  props: ChatPanelShellProps;
  stateStore: ChatStateStore;
  unsubscribe: () => void;
  stopStatusBarClearanceSync: () => void;
  shellState: ChatPanelShellState;
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
    shellState: createChatPanelShellState(props.stateStore.getState()),
    unsubscribe: props.stateStore.subscribe(() => {
      const current = shellMounts.get(container);
      if (!current) return;
      syncChatPanelShellState(current.shellState, props.stateStore.getState());
    }),
    stopStatusBarClearanceSync: startStatusBarClearanceSync(container),
  };
  shellMounts.set(container, mount);
  return mount;
}

function renderMountedShell(container: HTMLElement, mount: ChatPanelShellMount): void {
  if (!uiRootIntact(container, mount.props.showToolbar)) {
    unmountUiRoot(container);
    container.replaceChildren();
  }
  syncStatusBarClearance(container);
  renderUiRoot(container, <ChatPanelShell {...mount.props} shellState={mount.shellState} />);
}

function uiRootIntact(container: HTMLElement, showToolbar: boolean): boolean {
  const topLevel = Array.from(container.children);
  const toolbar = shellRegion(container, "toolbar");
  const body = shellRegion(container, "body");
  if (!body) return false;
  const expectedTopLevelCount = showToolbar ? 2 : 1;
  if (topLevel.length !== expectedTopLevelCount) return false;
  if (showToolbar) {
    if (!toolbar) return false;
    if (topLevel[0] !== toolbar || topLevel[1] !== body) return false;
  } else if (topLevel[0] !== body) {
    return false;
  }
  return Boolean(shellRegion(body, "goal") && shellRegion(body, "message-stream") && shellRegion(body, "composer"));
}

function shellRegion(container: HTMLElement, region: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`:scope > [data-codex-panel-shell-region="${region}"]`);
}

function ChatPanelShell({ showToolbar, parts, shellState }: ChatPanelShellProps & { shellState: ChatPanelShellState }): UiNode {
  return (
    <ChatPanelShellStateContext.Provider value={shellState}>
      {showToolbar ? (
        <div className="codex-panel__toolbar" data-codex-panel-shell-region="toolbar">
          <ChatPanelToolbar surface={parts.toolbar} />
        </div>
      ) : null}
      <div className="codex-panel__body" data-codex-panel-shell-region="body">
        <div className="codex-panel__region codex-panel__region--goal" data-codex-panel-shell-region="goal">
          <ChatPanelGoal surface={parts.goal} />
        </div>
        <ChatPanelMessageStream presenter={parts.messageStream} />
        <div className="codex-panel__region codex-panel__region--composer" data-codex-panel-shell-region="composer">
          <ChatPanelComposer controller={parts.composer} />
        </div>
      </div>
    </ChatPanelShellStateContext.Provider>
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

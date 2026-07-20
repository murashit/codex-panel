import type { ComponentChild as UiNode } from "preact";
import { useMemo } from "preact/hooks";
import { listenDomEvent } from "../../../shared/dom/events.dom";
import { renderUiRoot, unmountUiRoot } from "../../../shared/dom/preact-root.dom";
import type { ChatStateStore } from "../application/state/store";
import type { ThreadStreamScrollPortBinding } from "../ui/thread-stream/flow-scroll.measure";
import { ThreadStreamViewport } from "../ui/thread-stream/stream-blocks";
import type { ToolbarActions } from "../ui/toolbar";
import { useChatSelector } from "./chat-state-selector";
import { selectChatPanelComposer, selectChatPanelGoal, selectChatPanelThreadStream, selectChatPanelToolbar } from "./shell-selectors";
import { ChatPanelComposer, type ChatPanelComposerActions, type ChatPanelComposerPresenter } from "./surface/composer-projection";
import { ChatPanelGoal, type ChatPanelGoalSurface } from "./surface/goal-projection";
import { type ChatThreadStreamSurfaceContext, threadStreamSurfaceProjectionFromModel } from "./surface/thread-stream-projection";
import { ChatPanelToolbar, type ChatPanelToolbarSurface } from "./surface/toolbar-projection";

export interface ChatPanelShellParts {
  toolbar: {
    surface: ChatPanelToolbarSurface;
    actions: ToolbarActions;
  };
  goal: ChatPanelGoalSurface;
  threadStream: {
    context: ChatThreadStreamSurfaceContext;
    scrollPortBinding: ThreadStreamScrollPortBinding;
  };
  composer: {
    presenter: ChatPanelComposerPresenter;
    actions: ChatPanelComposerActions;
  };
}

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  showToolbar: boolean;
  parts: ChatPanelShellParts;
}

interface ChatPanelShellMount {
  props: ChatPanelShellProps;
  stopStatusBarClearanceSync: () => void;
}

const shellMounts = new WeakMap<HTMLElement, ChatPanelShellMount>();

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  container.addClass("codex-panel");
  const existing = shellMounts.get(container);
  const mount = existing ?? createShellMount(container, props);
  renderMountedShell(container, mount, props);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  const mount = shellMounts.get(container);
  mount?.stopStatusBarClearanceSync();
  shellMounts.delete(container);
  unmountUiRoot(container);
  container.replaceChildren();
}

function createShellMount(container: HTMLElement, props: ChatPanelShellProps): ChatPanelShellMount {
  const existing = shellMounts.get(container);
  existing?.stopStatusBarClearanceSync();
  const mount: ChatPanelShellMount = {
    props,
    stopStatusBarClearanceSync: startStatusBarClearanceSync(container),
  };
  shellMounts.set(container, mount);
  return mount;
}

function renderMountedShell(container: HTMLElement, mount: ChatPanelShellMount, props: ChatPanelShellProps): void {
  if (!uiRootIntact(container, mount.props.showToolbar)) {
    unmountUiRoot(container);
    container.replaceChildren();
  }
  syncStatusBarClearance(container);
  renderUiRoot(container, <ChatPanelShell {...props} />);
  mount.props = props;
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
  return Boolean(shellRegion(body, "goal") && shellRegion(body, "thread-stream") && shellRegion(body, "composer"));
}

function shellRegion(container: HTMLElement, region: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`:scope > [data-codex-panel-shell-region="${region}"]`);
}

function ChatPanelShell({ stateStore, showToolbar, parts }: ChatPanelShellProps): UiNode {
  return (
    <>
      {showToolbar ? (
        <div key="toolbar" className="codex-panel__toolbar" data-codex-panel-shell-region="toolbar">
          <ChatPanelToolbarRegion stateStore={stateStore} surface={parts.toolbar.surface} actions={parts.toolbar.actions} />
        </div>
      ) : null}
      <div key="body" className="codex-panel__body" data-codex-panel-shell-region="body">
        <div className="codex-panel__region codex-panel__region--goal" data-codex-panel-shell-region="goal">
          <ChatPanelGoalRegion stateStore={stateStore} surface={parts.goal} />
        </div>
        <ChatPanelThreadStreamRegion stateStore={stateStore} surface={parts.threadStream} />
        <div className="codex-panel__region codex-panel__region--composer" data-codex-panel-shell-region="composer">
          <ChatPanelComposerRegion stateStore={stateStore} presenter={parts.composer.presenter} actions={parts.composer.actions} />
        </div>
      </div>
    </>
  );
}

function ChatPanelToolbarRegion({
  stateStore,
  surface,
  actions,
}: {
  stateStore: ChatStateStore;
  surface: ChatPanelToolbarSurface;
  actions: ToolbarActions;
}): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelToolbar);
  return <ChatPanelToolbar model={model} stateStore={stateStore} surface={surface} actions={actions} />;
}

function ChatPanelGoalRegion({ stateStore, surface }: { stateStore: ChatStateStore; surface: ChatPanelGoalSurface }): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelGoal);
  return useMemo(() => <ChatPanelGoal model={model} surface={surface} />, [model, surface]);
}

function ChatPanelThreadStreamRegion({
  stateStore,
  surface,
}: {
  stateStore: ChatStateStore;
  surface: ChatPanelShellParts["threadStream"];
}): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelThreadStream);
  return useMemo(() => {
    const projection = threadStreamSurfaceProjectionFromModel(model, surface.context);
    return (
      <ThreadStreamViewport
        state={{
          blocks: projection.blocks,
          context: projection.context,
          scrollPortBinding: surface.scrollPortBinding,
        }}
        rootAttributes={{ "data-codex-panel-shell-region": "thread-stream" }}
      />
    );
  }, [model, surface]);
}

function ChatPanelComposerRegion({
  stateStore,
  presenter,
  actions,
}: {
  stateStore: ChatStateStore;
  presenter: ChatPanelComposerPresenter;
  actions: ChatPanelComposerActions;
}): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelComposer);
  return useMemo(() => <ChatPanelComposer model={model} presenter={presenter} actions={actions} />, [model, presenter, actions]);
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

  cleanupCallbacks.push(listenDomEvent(win, "resize", sync));
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

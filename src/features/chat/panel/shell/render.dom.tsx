import type { ComponentChild as UiNode } from "preact";
import { useMemo } from "preact/hooks";
import { listenDomEvent } from "../../../../shared/dom/events.dom";
import { renderUiRoot, unmountUiRoot } from "../../../../shared/dom/preact-root.dom";
import type { ChatStateStore } from "../../application/state/store";
import { ComposerShell } from "../../ui/composer";
import { GoalPanel } from "../../ui/goal";
import type { ThreadStreamScrollPortBinding } from "../../ui/thread-stream/flow-scroll.measure";
import { ThreadStreamViewport } from "../../ui/thread-stream/stream-blocks";
import { Toolbar, type ToolbarActions } from "../../ui/toolbar";
import type { ChatPanelComposerActions, ChatPanelComposerPresenter } from "../composer/view-projection";
import { type ChatPanelGoalDependencies, projectChatPanelGoal } from "../goal/view-projection";
import { type ChatThreadStreamDependencies, projectThreadStream } from "../thread-stream/view-projection";
import { type ChatPanelToolbarDependencies, projectChatPanelToolbar } from "../toolbar/view-projection";
import { selectChatPanelComposer, selectChatPanelGoal, selectChatPanelThreadStream, selectChatPanelToolbar } from "./selectors";
import { useChatSelector } from "./state-selector";

export interface ChatPanelShellParts {
  toolbar: {
    dependencies: ChatPanelToolbarDependencies;
    actions: ToolbarActions;
  };
  goal: ChatPanelGoalDependencies;
  threadStream: {
    context: ChatThreadStreamDependencies;
    scrollPortBinding: ThreadStreamScrollPortBinding;
  };
  composer: {
    presenter: ChatPanelComposerPresenter;
    actions: ChatPanelComposerActions;
  };
}

interface ChatPanelShellProps {
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
          <ChatPanelToolbarRegion stateStore={stateStore} dependencies={parts.toolbar.dependencies} actions={parts.toolbar.actions} />
        </div>
      ) : null}
      <div key="body" className="codex-panel__body" data-codex-panel-shell-region="body">
        <div className="codex-panel__region codex-panel__region--goal" data-codex-panel-shell-region="goal">
          <ChatPanelGoalRegion stateStore={stateStore} dependencies={parts.goal} />
        </div>
        <ChatPanelThreadStreamRegion stateStore={stateStore} dependencies={parts.threadStream} />
        <div className="codex-panel__region codex-panel__region--composer" data-codex-panel-shell-region="composer">
          <ChatPanelComposerRegion stateStore={stateStore} presenter={parts.composer.presenter} actions={parts.composer.actions} />
        </div>
      </div>
    </>
  );
}

function ChatPanelToolbarRegion({
  stateStore,
  dependencies,
  actions,
}: {
  stateStore: ChatStateStore;
  dependencies: ChatPanelToolbarDependencies;
  actions: ToolbarActions;
}): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelToolbar);
  return <Toolbar model={projectChatPanelToolbar(model, dependencies)} actions={actions} />;
}

function ChatPanelGoalRegion({
  stateStore,
  dependencies,
}: {
  stateStore: ChatStateStore;
  dependencies: ChatPanelGoalDependencies;
}): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelGoal);
  return <GoalPanel {...projectChatPanelGoal(model, dependencies)} />;
}

function ChatPanelThreadStreamRegion({
  stateStore,
  dependencies,
}: {
  stateStore: ChatStateStore;
  dependencies: ChatPanelShellParts["threadStream"];
}): UiNode {
  const model = useChatSelector(stateStore, selectChatPanelThreadStream);
  return useMemo(() => {
    const projection = projectThreadStream(model, dependencies.context);
    return (
      <ThreadStreamViewport
        state={{
          blocks: projection.blocks,
          context: projection.context,
          scrollPortBinding: dependencies.scrollPortBinding,
        }}
        rootAttributes={{ "data-codex-panel-shell-region": "thread-stream" }}
      />
    );
  }, [model, dependencies]);
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
  return useMemo(() => <ComposerShell {...presenter.renderState(model, actions)} />, [model, presenter, actions]);
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

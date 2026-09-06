import type { ComponentChild as UiNode } from "preact";
import { useMemo } from "preact/hooks";
import { listenDomEvent } from "../../../../shared/dom/events.dom";
import { unmountUiRoot } from "../../../../shared/dom/preact-root.dom";
import { renderObsidianUiRoot } from "../../../../shared/obsidian/preact-root.obsidian";
import type { ThreadCatalogPaginatedActiveReader } from "../../../threads/catalog/thread-catalog";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { activeThreadId, type ChatState } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { ComposerShell } from "../../ui/composer/composer";
import { GoalPanel } from "../../ui/goal/goal";
import type { ThreadStreamScrollPortBinding } from "../../ui/thread-stream/flow-scroll.measure";
import { ThreadStreamViewport } from "../../ui/thread-stream/stream-blocks";
import { Toolbar, type ToolbarActions } from "../../ui/toolbar/toolbar";
import type { ChatPanelComposerActions, ChatPanelComposerPresenter } from "../composer/view-projection";
import type { ChatThreadGoalQueries } from "../contracts";
import { type ChatPanelGoalDependencies, projectChatPanelGoal } from "../goal/view-projection";
import { type ChatThreadStreamDependencies, projectThreadStream } from "../thread-stream/view-projection";
import { type ChatPanelToolbarDependencies, projectChatPanelToolbar } from "../toolbar/view-projection";
import { selectChatPanelComposer, selectChatPanelGoal, selectChatPanelThreadStream, selectChatPanelToolbar } from "./selectors";
import {
  type ChatSharedDisplayQueries,
  type ChatToolInventoryDisplayQueries,
  metadataDiagnosticsFromResources,
  useActiveThreadsResource,
  useModelsResource,
  usePermissionProfilesProbe,
  useRateLimitsResource,
  useRuntimeConfigResource,
  useSkillsResource,
  useThreadGoalResource,
  useToolInventoryResource,
} from "./shared-resource-hooks";
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
  appServerQueries: ChatSharedDisplayQueries;
  toolInventoryQueries: ChatToolInventoryDisplayQueries;
  threadGoalQueries: ChatThreadGoalQueries;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
  showToolbar: boolean;
  parts: ChatPanelShellParts;
}

const shellMounts = new WeakMap<HTMLElement, () => void>();

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  container.addClass("codex-panel");
  if (!shellMounts.has(container)) {
    unmountUiRoot(container);
    container.replaceChildren();
    shellMounts.set(container, startStatusBarClearanceSync(container));
  }
  syncStatusBarClearance(container);
  renderObsidianUiRoot(container, <ChatPanelShell {...props} />);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  shellMounts.get(container)?.();
  shellMounts.delete(container);
  unmountUiRoot(container);
  container.replaceChildren();
}

function ChatPanelShell({
  stateStore,
  appServerQueries,
  toolInventoryQueries,
  threadGoalQueries,
  threadCatalog,
  showToolbar,
  parts,
}: ChatPanelShellProps): UiNode {
  return (
    <>
      {showToolbar ? (
        <div key="toolbar" className="codex-panel__toolbar">
          <ChatPanelToolbarRegion
            stateStore={stateStore}
            appServerQueries={appServerQueries}
            toolInventoryQueries={toolInventoryQueries}
            threadCatalog={threadCatalog}
            dependencies={parts.toolbar.dependencies}
            actions={parts.toolbar.actions}
          />
        </div>
      ) : null}
      <div key="body" className="codex-panel__body">
        <div className="codex-panel__region codex-panel__region--goal">
          <ChatPanelGoalRegion stateStore={stateStore} threadGoalQueries={threadGoalQueries} dependencies={parts.goal} />
        </div>
        <ChatPanelThreadStreamRegion stateStore={stateStore} threadCatalog={threadCatalog} dependencies={parts.threadStream} />
        <div className="codex-panel__region codex-panel__region--composer">
          <ChatPanelComposerRegion
            stateStore={stateStore}
            appServerQueries={appServerQueries}
            threadCatalog={threadCatalog}
            presenter={parts.composer.presenter}
            actions={parts.composer.actions}
          />
        </div>
      </div>
    </>
  );
}

function ChatPanelToolbarRegion({
  stateStore,
  appServerQueries,
  toolInventoryQueries,
  threadCatalog,
  dependencies,
  actions,
}: {
  stateStore: ChatStateStore;
  appServerQueries: ChatSharedDisplayQueries;
  toolInventoryQueries: ChatToolInventoryDisplayQueries;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
  dependencies: ChatPanelToolbarDependencies;
  actions: ToolbarActions;
}): UiNode {
  const activeThreads = useActiveThreadsResource(threadCatalog);
  const runtimeConfig = useRuntimeConfigResource(appServerQueries);
  const models = useModelsResource(appServerQueries);
  const skills = useSkillsResource(appServerQueries);
  const permissionProfilesProbe = usePermissionProfilesProbe(appServerQueries);
  const rateLimits = useRateLimitsResource(appServerQueries);
  const { threadId, enabled: toolInventoryEnabled } = useChatSelector(stateStore, selectToolInventoryKey);
  const toolInventory = useToolInventoryResource(toolInventoryQueries, threadId, toolInventoryEnabled);
  const metadataDiagnostics = useMemo(
    () => metadataDiagnosticsFromResources({ models, skills, permissionProfilesProbe, rateLimits }),
    [models, skills, permissionProfilesProbe, rateLimits],
  );
  const selector = useMemo(
    () => (state: ChatState) =>
      selectChatPanelToolbar(state, {
        activeThreads,
        runtimeConfig,
        models: models.value,
        skills: skills.value,
        rateLimit: rateLimits.value,
        metadataDiagnostics,
        toolInventory,
      }),
    [activeThreads, runtimeConfig, models, skills, rateLimits, metadataDiagnostics, toolInventory],
  );
  const model = useChatSelector(stateStore, selector);
  return <Toolbar model={projectChatPanelToolbar(model, dependencies, Date.now())} actions={actions} />;
}

function selectToolInventoryKey(state: ChatState): { threadId: string | null; enabled: boolean } {
  return {
    threadId: activeThreadId(state),
    enabled: state.connection.phase.kind === "connected" && state.ui.toolbarPanel === "status-panel",
  };
}

function ChatPanelGoalRegion({
  stateStore,
  threadGoalQueries,
  dependencies,
}: {
  stateStore: ChatStateStore;
  threadGoalQueries: ChatThreadGoalQueries;
  dependencies: ChatPanelGoalDependencies;
}): UiNode {
  const { threadId, enabled } = useChatSelector(stateStore, selectThreadGoalKey);
  const goalResource = useThreadGoalResource(threadGoalQueries, threadId, enabled);
  const selector = useMemo(() => (state: ChatState) => selectChatPanelGoal(state, goalResource.goal), [goalResource.goal]);
  const model = useChatSelector(stateStore, selector);
  return (
    <>
      {goalResource.error ? <div className="codex-panel__goal-load-error">Could not load thread goal: {goalResource.error}</div> : null}
      <GoalPanel {...projectChatPanelGoal(model, dependencies)} />
    </>
  );
}

function selectThreadGoalKey(state: ChatState): { threadId: string | null; enabled: boolean } {
  return {
    threadId: activeThreadId(state),
    enabled: state.connection.phase.kind === "connected" && activePanelOperationDecision(state, "goal-read").kind === "allowed",
  };
}

function ChatPanelThreadStreamRegion({
  stateStore,
  threadCatalog,
  dependencies,
}: {
  stateStore: ChatStateStore;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
  dependencies: ChatPanelShellParts["threadStream"];
}): UiNode {
  const activeThreads = useActiveThreadsResource(threadCatalog);
  const selector = useMemo(
    () => (state: ChatState) => selectChatPanelThreadStream(state, { threads: activeThreads.threads }),
    [activeThreads.threads],
  );
  const model = useChatSelector(stateStore, selector);
  return useMemo(() => {
    const projection = projectThreadStream(model, dependencies.context);
    return (
      <ThreadStreamViewport
        state={{
          blocks: projection.blocks,
          context: projection.context,
          scrollPortBinding: dependencies.scrollPortBinding,
        }}
      />
    );
  }, [model, dependencies]);
}

function ChatPanelComposerRegion({
  stateStore,
  appServerQueries,
  threadCatalog,
  presenter,
  actions,
}: {
  stateStore: ChatStateStore;
  appServerQueries: ChatSharedDisplayQueries;
  threadCatalog: ThreadCatalogPaginatedActiveReader;
  presenter: ChatPanelComposerPresenter;
  actions: ChatPanelComposerActions;
}): UiNode {
  const activeThreads = useActiveThreadsResource(threadCatalog);
  const runtimeConfig = useRuntimeConfigResource(appServerQueries);
  const models = useModelsResource(appServerQueries);
  const rateLimits = useRateLimitsResource(appServerQueries);
  const selector = useMemo(
    () => (state: ChatState) =>
      selectChatPanelComposer(state, {
        threads: activeThreads.threads,
        runtimeConfig,
        models: models.value,
        rateLimit: rateLimits.value,
      }),
    [activeThreads.threads, runtimeConfig, models.value, rateLimits.value],
  );
  const model = useChatSelector(stateStore, selector);
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

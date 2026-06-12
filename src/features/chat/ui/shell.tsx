import { createContext, type ComponentChild as UiNode } from "preact";
import { useContext } from "preact/hooks";
import { signal, type Signal } from "@preact/signals";
import { renderUiRoot, unmountUiRoot } from "../../../shared/ui/ui-root";
import type { ChatState, ChatStateStore } from "../state/reducer";

export interface ChatPanelShellState {
  connection: Signal<ChatState["connection"]>;
  threadList: Signal<ChatState["threadList"]>;
  activeThread: Signal<ChatState["activeThread"]>;
  runtime: Signal<ChatState["runtime"]>;
  turn: Signal<ChatState["turn"]>;
  messageStream: Signal<ChatState["messageStream"]>;
  requests: Signal<ChatState["requests"]>;
  composer: Signal<ChatState["composer"]>;
  ui: Signal<ChatState["ui"]>;
  renderVersion: Signal<number>;
  latestState: () => ChatState;
}

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  showToolbar: boolean;
  toolbarNode: () => UiNode;
  goalNode: () => UiNode;
  messageStreamNode: () => UiNode;
  composerNode: () => UiNode;
}

interface ChatPanelShellMount {
  props: ChatPanelShellProps;
  stateStore: ChatStateStore;
  unsubscribe: () => void;
  stopStatusBarClearanceSync: () => void;
  shellState: ChatPanelShellState;
}

const shellMounts = new WeakMap<HTMLElement, ChatPanelShellMount>();
const ChatPanelShellStateContext = createContext<ChatPanelShellState | null>(null);

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  container.addClass("codex-panel");
  const existing = shellMounts.get(container);
  const mount = existing?.stateStore === props.stateStore ? existing : createShellMount(container, props);
  mount.props = props;
  mount.shellState.renderVersion.value += 1;
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
  let latestState = props.stateStore.getState();
  const mount: ChatPanelShellMount = {
    props,
    stateStore: props.stateStore,
    shellState: createShellState(latestState, () => latestState),
    unsubscribe: props.stateStore.subscribe(() => {
      const current = shellMounts.get(container);
      if (!current) return;
      latestState = props.stateStore.getState();
      syncShellState(current.shellState, latestState);
      if (!uiRootIntact(container)) renderMountedShell(container, current);
    }),
    stopStatusBarClearanceSync: startStatusBarClearanceSync(container),
  };
  shellMounts.set(container, mount);
  return mount;
}

function createShellState(initialState: ChatState, latestState: () => ChatState): ChatPanelShellState {
  return {
    connection: signal(initialState.connection),
    threadList: signal(initialState.threadList),
    activeThread: signal(initialState.activeThread),
    runtime: signal(initialState.runtime),
    turn: signal(initialState.turn),
    messageStream: signal(initialState.messageStream),
    requests: signal(initialState.requests),
    composer: signal(initialState.composer),
    ui: signal(initialState.ui),
    renderVersion: signal(0),
    latestState,
  };
}

function syncShellState(shellState: ChatPanelShellState, nextState: ChatState): void {
  if (shellState.connection.value !== nextState.connection) shellState.connection.value = nextState.connection;
  if (shellState.threadList.value !== nextState.threadList) shellState.threadList.value = nextState.threadList;
  if (shellState.activeThread.value !== nextState.activeThread) shellState.activeThread.value = nextState.activeThread;
  if (shellState.runtime.value !== nextState.runtime) shellState.runtime.value = nextState.runtime;
  if (shellState.turn.value !== nextState.turn) shellState.turn.value = nextState.turn;
  if (shellState.messageStream.value !== nextState.messageStream) shellState.messageStream.value = nextState.messageStream;
  if (shellState.requests.value !== nextState.requests) shellState.requests.value = nextState.requests;
  if (shellState.composer.value !== nextState.composer) shellState.composer.value = nextState.composer;
  if (shellState.ui.value !== nextState.ui) shellState.ui.value = nextState.ui;
}

function renderMountedShell(container: HTMLElement, mount: ChatPanelShellMount): void {
  if (!uiRootIntact(container)) {
    unmountUiRoot(container);
    container.replaceChildren();
  }
  syncStatusBarClearance(container);
  renderUiRoot(container, <ChatPanelShell {...mount.props} shellState={mount.shellState} />);
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
  messageStreamNode,
  composerNode,
  shellState,
}: ChatPanelShellProps & { shellState: ChatPanelShellState }): UiNode {
  return (
    <ChatPanelShellStateContext.Provider value={shellState}>
      {showToolbar ? <div className="codex-panel__toolbar">{toolbarNode()}</div> : null}
      <div className="codex-panel__body">
        <div className="codex-panel__region codex-panel__region--goal">{goalNode()}</div>
        {messageStreamNode()}
        <div className="codex-panel__region codex-panel__region--composer">{composerNode()}</div>
      </div>
    </ChatPanelShellStateContext.Provider>
  );
}

export function useChatPanelShellState(): ChatPanelShellState {
  const context = useContext(ChatPanelShellStateContext);
  if (!context) throw new Error("Chat panel shell state is only available inside ChatPanelShell.");
  return context;
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

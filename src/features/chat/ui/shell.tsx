import { unmountUiRoot } from "../../../shared/ui/ui-root";
import type { ChatState, ChatStateStore } from "../chat-state";
import type { ChatPanelSlotSnapshot } from "../view-snapshot";

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  renderVersion: number;
  showToolbar: boolean;
  toolbar: ChatPanelSlotProps;
  messages: ChatPanelSlotProps;
  composer: ChatPanelSlotProps;
}

interface ChatPanelShellMount {
  props: ChatPanelShellProps;
  stateStore: ChatStateStore;
  unsubscribe: () => void;
  stopStatusBarClearanceSync: () => void;
}

const shellMounts = new WeakMap<HTMLElement, ChatPanelShellMount>();

const shellSlots = {
  toolbar: {
    selector: ":scope > .codex-panel__toolbar",
    create(container: HTMLElement): HTMLElement {
      const toolbar = container.createDiv({ cls: "codex-panel__toolbar" });
      const body = container.querySelector<HTMLElement>(":scope > .codex-panel__body");
      if (body) container.insertBefore(toolbar, body);
      return toolbar;
    },
    props(props: ChatPanelShellProps): ChatPanelSlotProps {
      return props.toolbar;
    },
  },
  messages: {
    selector: ":scope > .codex-panel__body > .codex-panel__slot--messages > .codex-panel__messages",
    create(container: HTMLElement): HTMLElement {
      const body = ensureBody(container);
      const messagesSlot = body.createDiv({ cls: "codex-panel__slot codex-panel__slot--messages" });
      return messagesSlot.createDiv({ cls: "codex-panel__messages" });
    },
    props(props: ChatPanelShellProps): ChatPanelSlotProps {
      return props.messages;
    },
  },
  composer: {
    selector: ":scope > .codex-panel__body > .codex-panel__slot--composer",
    create(container: HTMLElement): HTMLElement {
      return ensureBody(container).createDiv({ cls: "codex-panel__slot codex-panel__slot--composer" });
    },
    props(props: ChatPanelShellProps): ChatPanelSlotProps {
      return props.composer;
    },
  },
};

const shellSlotDefinitions = Object.values(shellSlots);

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  container.addClass("codex-panel");
  ensureShellDom(container, props.showToolbar);
  const existing = shellMounts.get(container);
  if (existing?.stateStore === props.stateStore) {
    existing.props = props;
    syncStatusBarClearance(container);
  } else {
    existing?.unsubscribe();
    existing?.stopStatusBarClearanceSync();
    shellMounts.set(container, {
      props,
      stateStore: props.stateStore,
      unsubscribe: props.stateStore.subscribe(() => {
        const mount = shellMounts.get(container);
        if (!mount) return;
        renderMountedSlots(container, mount.props);
      }),
      stopStatusBarClearanceSync: startStatusBarClearanceSync(container),
    });
  }
  renderMountedSlots(container, props);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  const mount = shellMounts.get(container);
  mount?.unsubscribe();
  mount?.stopStatusBarClearanceSync();
  shellMounts.delete(container);
  unmountSlotRoots(container);
  container.replaceChildren();
}

interface ChatPanelSlotProps {
  render: (slot: HTMLElement) => void;
  snapshot: (state: ChatState) => ChatPanelSlotSnapshot;
}

function ensureShellDom(container: HTMLElement, showToolbar: boolean): void {
  if (!showToolbar) {
    const toolbar = container.querySelector<HTMLElement>(shellSlots.toolbar.selector);
    unmountUiRoot(toolbar);
    toolbar?.remove();
  }
  const requiredSlots = activeShellSlotDefinitions(showToolbar);
  if (requiredSlots.every((slot) => container.querySelector(slot.selector))) {
    return;
  }
  // The shell owns the fixed Obsidian DOM scaffold; toolbar, messages, and
  // composer each own their own Preact root inside that scaffold.
  unmountSlotRoots(container);
  container.replaceChildren();
  for (const slot of requiredSlots) {
    slot.create(container);
  }
}

function renderSlotIfNeeded(element: HTMLElement, slot: ChatPanelSlotProps, renderKey: string): void {
  if (element.dataset["codexPanelSlotRenderKey"] === renderKey) return;
  slot.render(element);
  element.dataset["codexPanelSlotRenderKey"] = renderKey;
}

function renderMountedSlots(container: HTMLElement, props: ChatPanelShellProps): void {
  const state = props.stateStore.getState();
  for (const slotDefinition of activeShellSlotDefinitions(props.showToolbar)) {
    const element = container.querySelector<HTMLElement>(slotDefinition.selector);
    if (!element) continue;
    const slot = slotDefinition.props(props);
    renderSlotIfNeeded(element, slot, renderKey(props.renderVersion, slot.snapshot(state)));
  }
}

function activeShellSlotDefinitions(showToolbar: boolean): typeof shellSlotDefinitions {
  return showToolbar ? shellSlotDefinitions : shellSlotDefinitions.filter((slot) => slot !== shellSlots.toolbar);
}

function unmountSlotRoots(container: HTMLElement): void {
  for (const slotDefinition of shellSlotDefinitions) {
    unmountUiRoot(container.querySelector<HTMLElement>(slotDefinition.selector));
  }
}

function renderKey(renderVersion: number, snapshot: ChatPanelSlotSnapshot): string {
  return `${String(renderVersion)}\u001f${String(snapshot)}`;
}

function ensureBody(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(":scope > .codex-panel__body") ?? container.createDiv({ cls: "codex-panel__body" });
}

function startStatusBarClearanceSync(container: HTMLElement): () => void {
  const win = container.ownerDocument.defaultView;
  if (!win) return noop;

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

function noop(): void {
  return undefined;
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

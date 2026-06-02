import { unmountUiRoot } from "../../../shared/ui/ui-root";
import type { ChatState, ChatStateStore } from "../chat-state";
import type { ChatPanelSlotSnapshot } from "../view-snapshot";

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  renderVersion: number;
  toolbar: ChatPanelSlotProps;
  messages: ChatPanelSlotProps;
  composer: ChatPanelSlotProps;
}

interface ChatPanelShellMount {
  props: ChatPanelShellProps;
  stateStore: ChatStateStore;
  unsubscribe: () => void;
}

const shellMounts = new WeakMap<HTMLElement, ChatPanelShellMount>();

const shellSlots = {
  toolbar: {
    selector: ":scope > .codex-panel__toolbar",
    create(container: HTMLElement): HTMLElement {
      return container.createDiv({ cls: "codex-panel__toolbar" });
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
  ensureShellDom(container);
  const existing = shellMounts.get(container);
  if (existing?.stateStore === props.stateStore) {
    existing.props = props;
  } else {
    existing?.unsubscribe();
    shellMounts.set(container, {
      props,
      stateStore: props.stateStore,
      unsubscribe: props.stateStore.subscribe(() => {
        const mount = shellMounts.get(container);
        if (!mount) return;
        renderMountedSlots(container, mount.props);
      }),
    });
  }
  renderMountedSlots(container, props);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  shellMounts.get(container)?.unsubscribe();
  shellMounts.delete(container);
  unmountSlotRoots(container);
  container.replaceChildren();
}

interface ChatPanelSlotProps {
  render: (slot: HTMLElement) => void;
  snapshot: (state: ChatState) => ChatPanelSlotSnapshot;
}

function ensureShellDom(container: HTMLElement): void {
  if (shellSlotDefinitions.every((slot) => container.querySelector(slot.selector))) {
    return;
  }
  // The shell owns the fixed Obsidian DOM scaffold; toolbar, messages, and
  // composer each own their own Preact root inside that scaffold.
  unmountSlotRoots(container);
  container.replaceChildren();
  shellSlots.toolbar.create(container);
  const body = ensureBody(container);
  body.createDiv({ cls: "codex-panel__slot codex-panel__slot--config" });
  shellSlots.messages.create(container);
  shellSlots.composer.create(container);
}

function renderSlotIfNeeded(element: HTMLElement, slot: ChatPanelSlotProps, renderKey: string): void {
  if (element.dataset["codexPanelSlotRenderKey"] === renderKey) return;
  slot.render(element);
  element.dataset["codexPanelSlotRenderKey"] = renderKey;
}

function renderMountedSlots(container: HTMLElement, props: ChatPanelShellProps): void {
  const state = props.stateStore.getState();
  for (const slotDefinition of shellSlotDefinitions) {
    const element = container.querySelector<HTMLElement>(slotDefinition.selector);
    if (!element) continue;
    const slot = slotDefinition.props(props);
    renderSlotIfNeeded(element, slot, renderKey(props.renderVersion, slot.snapshot(state)));
  }
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

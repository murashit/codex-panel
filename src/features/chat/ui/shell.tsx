import { unmountReactRoot } from "../../../shared/ui/react-root";
import type { ChatState, ChatStateStore } from "../chat-state";

export type ChatPanelSlotSnapshot = string | number | boolean | null;

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
  if (
    container.querySelector(":scope > .codex-panel__toolbar") &&
    container.querySelector(":scope > .codex-panel__body > .codex-panel__slot--messages > .codex-panel__messages") &&
    container.querySelector(":scope > .codex-panel__body > .codex-panel__slot--composer")
  ) {
    return;
  }
  unmountSlotRoots(container);
  container.replaceChildren();
  container.createDiv({ cls: "codex-panel__toolbar" });
  const body = container.createDiv({ cls: "codex-panel__body" });
  body.createDiv({ cls: "codex-panel__slot codex-panel__slot--config" });
  const messagesSlot = body.createDiv({ cls: "codex-panel__slot codex-panel__slot--messages" });
  messagesSlot.createDiv({ cls: "codex-panel__messages" });
  body.createDiv({ cls: "codex-panel__slot codex-panel__slot--composer" });
}

function renderSlotIfNeeded(element: HTMLElement, slot: ChatPanelSlotProps, renderKey: string): void {
  if (element.dataset["codexPanelSlotRenderKey"] === renderKey) return;
  slot.render(element);
  element.dataset["codexPanelSlotRenderKey"] = renderKey;
}

function renderMountedSlots(container: HTMLElement, props: ChatPanelShellProps): void {
  const state = props.stateStore.getState();
  const toolbar = container.querySelector<HTMLElement>(":scope > .codex-panel__toolbar");
  const messages = container.querySelector<HTMLElement>(
    ":scope > .codex-panel__body > .codex-panel__slot--messages > .codex-panel__messages",
  );
  const composer = container.querySelector<HTMLElement>(":scope > .codex-panel__body > .codex-panel__slot--composer");
  if (toolbar) renderSlotIfNeeded(toolbar, props.toolbar, renderKey(props.renderVersion, props.toolbar.snapshot(state)));
  if (messages) renderSlotIfNeeded(messages, props.messages, renderKey(props.renderVersion, props.messages.snapshot(state)));
  if (composer) renderSlotIfNeeded(composer, props.composer, renderKey(props.renderVersion, props.composer.snapshot(state)));
}

function unmountSlotRoots(container: HTMLElement): void {
  unmountReactRoot(container.querySelector<HTMLElement>(":scope > .codex-panel__toolbar"));
  unmountReactRoot(
    container.querySelector<HTMLElement>(":scope > .codex-panel__body > .codex-panel__slot--messages > .codex-panel__messages"),
  );
  unmountReactRoot(container.querySelector<HTMLElement>(":scope > .codex-panel__body > .codex-panel__slot--composer"));
}

function renderKey(renderVersion: number, snapshot: ChatPanelSlotSnapshot): string {
  return `${String(renderVersion)}\u001f${String(snapshot)}`;
}

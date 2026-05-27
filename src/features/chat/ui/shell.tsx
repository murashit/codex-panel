import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { renderReactRoot, unmountReactRoot } from "../../../shared/ui/react-root";
import type { ChatState, ChatStateStore } from "../chat-state";

export type ChatPanelSlotSnapshot = string | number | boolean | null;

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  renderVersion: number;
  toolbar: ChatPanelSlotProps;
  messages: ChatPanelSlotProps;
  composer: ChatPanelSlotProps;
}

interface ChatPanelShellSlots {
  toolbar?: HTMLElement;
  messages?: HTMLElement;
  composer?: HTMLElement;
}

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  const mountedSlots: ChatPanelShellSlots = {};
  container.addClass("codex-panel");
  renderReactRoot(
    container,
    <ChatPanelShell
      {...props}
      onSlotReady={(name, element) => {
        mountedSlots[name] = element;
      }}
    />,
  );
  renderMountedSlots(mountedSlots, props);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  unmountReactRoot(container);
}

function ChatPanelShell({
  stateStore,
  renderVersion,
  toolbar,
  messages,
  composer,
  onSlotReady,
}: ChatPanelShellProps & { onSlotReady: (name: keyof ChatPanelShellSlots, element: HTMLElement) => void }): ReactNode {
  return (
    <>
      <ChatPanelSlot
        name="toolbar"
        className="codex-panel__toolbar"
        stateStore={stateStore}
        renderVersion={renderVersion}
        slot={toolbar}
        onSlotReady={onSlotReady}
      />
      <div className="codex-panel__body">
        <div className="codex-panel__slot codex-panel__slot--config" />
        <ChatPanelSlot
          name="messages"
          className="codex-panel__slot codex-panel__slot--messages"
          stateStore={stateStore}
          renderVersion={renderVersion}
          slot={messages}
          onSlotReady={onSlotReady}
        />
        <ChatPanelSlot
          name="composer"
          className="codex-panel__slot codex-panel__slot--composer"
          stateStore={stateStore}
          renderVersion={renderVersion}
          slot={composer}
          onSlotReady={onSlotReady}
        />
      </div>
    </>
  );
}

interface ChatPanelSlotProps {
  render: (slot: HTMLElement) => void;
  snapshot: (state: ChatState) => ChatPanelSlotSnapshot;
}

function ChatPanelSlot({
  name,
  className,
  stateStore,
  renderVersion,
  slot,
  onSlotReady,
}: {
  name: keyof ChatPanelShellSlots;
  className: string;
  stateStore: ChatStateStore;
  renderVersion: number;
  slot: ChatPanelSlotProps;
  onSlotReady: (name: keyof ChatPanelShellSlots, element: HTMLElement) => void;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    (listener) => stateStore.subscribe(listener),
    () => slot.snapshot(stateStore.getState()),
    () => slot.snapshot(stateStore.getState()),
  );
  const ref = useRef<HTMLDivElement | null>(null);
  const renderGeneration = useRef(0);
  const renderKey = `${String(renderVersion)}\u001f${String(snapshot)}`;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    onSlotReady(name, element);
    const generation = ++renderGeneration.current;
    void Promise.resolve().then(() => {
      if (generation !== renderGeneration.current || !element.isConnected) return;
      renderSlotIfNeeded(element, slot, renderKey);
    });
  }, [name, onSlotReady, renderKey, slot]);

  return <div ref={ref} className={className} />;
}

function renderMountedSlots(slots: ChatPanelShellSlots, props: ChatPanelShellProps): void {
  const state = props.stateStore.getState();
  if (slots.toolbar) renderSlotIfNeeded(slots.toolbar, props.toolbar, slotRenderKey(props.renderVersion, props.toolbar.snapshot(state)));
  if (slots.messages)
    renderSlotIfNeeded(slots.messages, props.messages, slotRenderKey(props.renderVersion, props.messages.snapshot(state)));
  if (slots.composer)
    renderSlotIfNeeded(slots.composer, props.composer, slotRenderKey(props.renderVersion, props.composer.snapshot(state)));
}

function renderSlotIfNeeded(element: HTMLElement, slot: ChatPanelSlotProps, renderKey: string): void {
  if (element.dataset["codexPanelSlotRenderKey"] === renderKey) return;
  slot.render(element);
  element.dataset["codexPanelSlotRenderKey"] = renderKey;
}

function slotRenderKey(renderVersion: number, snapshot: ChatPanelSlotSnapshot): string {
  return `${String(renderVersion)}\u001f${String(snapshot)}`;
}

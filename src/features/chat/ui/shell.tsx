import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "preact/compat";

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

const shellSlotsByContainer = new WeakMap<HTMLElement, ChatPanelShellSlots>();

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  const mountedSlots = shellSlotsByContainer.get(container) ?? {};
  shellSlotsByContainer.set(container, mountedSlots);
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
  shellSlotsByContainer.delete(container);
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
        key="toolbar"
        name="toolbar"
        className="codex-panel__toolbar"
        stateStore={stateStore}
        renderVersion={renderVersion}
        slot={toolbar}
        onSlotReady={onSlotReady}
      />
      <div key="body" className="codex-panel__body">
        <div key="config" className="codex-panel__slot codex-panel__slot--config" />
        <ChatPanelSlot
          key="messages"
          name="messages"
          className="codex-panel__slot codex-panel__slot--messages"
          renderTargetClassName="codex-panel__messages"
          stateStore={stateStore}
          renderVersion={renderVersion}
          slot={messages}
          onSlotReady={onSlotReady}
        />
        <ChatPanelSlot
          key="composer"
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
  renderTargetClassName,
  stateStore,
  renderVersion,
  slot,
  onSlotReady,
}: {
  name: keyof ChatPanelShellSlots;
  className: string;
  renderTargetClassName?: string;
  stateStore: ChatStateStore;
  renderVersion: number;
  slot: ChatPanelSlotProps;
  onSlotReady: (name: keyof ChatPanelShellSlots, element: HTMLElement) => void;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    (listener) => stateStore.subscribe(listener),
    () => slot.snapshot(stateStore.getState()),
  );
  const ref = useRef<HTMLDivElement | null>(null);
  const renderGeneration = useRef(0);
  const renderKey = `${String(renderVersion)}\u001f${String(snapshot)}`;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const renderTarget = renderTargetClassName ? element.querySelector<HTMLElement>(`:scope > .${renderTargetClassName}`) : element;
    if (!renderTarget) return;
    onSlotReady(name, renderTarget);
    const generation = ++renderGeneration.current;
    void Promise.resolve().then(() => {
      if (generation !== renderGeneration.current || !element.isConnected) return;
      renderSlotIfNeeded(renderTarget, slot, renderKey);
    });
  }, [name, onSlotReady, renderKey, renderTargetClassName, slot]);

  return (
    <div
      ref={(element) => {
        ref.current = element;
        if (!element) return;
        const renderTarget = renderTargetClassName ? element.querySelector<HTMLElement>(`:scope > .${renderTargetClassName}`) : element;
        if (renderTarget) onSlotReady(name, renderTarget);
      }}
      className={className}
    >
      {renderTargetClassName ? <div className={renderTargetClassName} /> : null}
    </div>
  );
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

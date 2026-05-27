import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { renderReactRoot, unmountReactRoot } from "../../../shared/ui/react-root";
import type { ChatStateStore } from "../chat-state";

export interface ChatPanelShellProps {
  stateStore: ChatStateStore;
  renderToolbar: (toolbar: HTMLElement) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
}

interface ChatPanelShellSlots {
  toolbar: HTMLElement;
  messages: HTMLElement;
  composer: HTMLElement;
}

export function renderChatPanelShell(container: HTMLElement, props: ChatPanelShellProps): void {
  const mountedSlots: { current: ChatPanelShellSlots | null } = { current: null };
  container.addClass("codex-panel");
  renderReactRoot(
    container,
    <ChatPanelShell
      {...props}
      onSlotsReady={(slots) => {
        mountedSlots.current = slots;
      }}
    />,
  );
  const slots = mountedSlots.current;
  if (slots) renderChatPanelShellSlots(slots, props);
}

export function unmountChatPanelShell(container: HTMLElement | null): void {
  if (!container) return;
  unmountReactRoot(container);
}

function ChatPanelShell({
  stateStore,
  renderToolbar,
  renderMessages,
  renderComposer,
  onSlotsReady,
}: ChatPanelShellProps & { onSlotsReady: (slots: ChatPanelShellSlots) => void }): ReactNode {
  const state = useSyncExternalStore(
    (listener) => stateStore.subscribe(listener),
    () => stateStore.getState(),
    () => stateStore.getState(),
  );
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const renderGeneration = useRef(0);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const messages = messagesRef.current;
    const composer = composerRef.current;
    if (!toolbar || !messages || !composer) return;

    const slots = { toolbar, messages, composer };
    onSlotsReady(slots);
    const generation = ++renderGeneration.current;
    void Promise.resolve().then(() => {
      if (generation !== renderGeneration.current || !toolbar.isConnected || !messages.isConnected || !composer.isConnected) return;
      renderChatPanelShellSlots(slots, { renderToolbar, renderMessages, renderComposer });
    });
  }, [state, stateStore, renderToolbar, renderMessages, renderComposer, onSlotsReady]);

  return (
    <>
      <div ref={toolbarRef} className="codex-panel__toolbar" />
      <div className="codex-panel__body">
        <div className="codex-panel__slot codex-panel__slot--config" />
        <div ref={messagesRef} className="codex-panel__slot codex-panel__slot--messages" />
        <div ref={composerRef} className="codex-panel__slot codex-panel__slot--composer" />
      </div>
    </>
  );
}

function renderChatPanelShellSlots(
  slots: ChatPanelShellSlots,
  { renderToolbar, renderMessages, renderComposer }: Pick<ChatPanelShellProps, "renderToolbar" | "renderMessages" | "renderComposer">,
): void {
  renderToolbar(slots.toolbar);
  renderMessages(slots.messages);
  renderComposer(slots.composer);
}

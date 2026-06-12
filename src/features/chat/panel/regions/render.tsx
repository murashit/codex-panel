import type { ComponentChild as UiNode } from "preact";
import { useComputed } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";

import { goalBannerNode } from "../../ui/goal-banner";
import { useChatPanelShellState } from "../../ui/shell";
import { toolbarNode } from "../../ui/toolbar";
import { chatPanelGoalProps } from "./goal";
import { chatPanelMessagesNode } from "./messages";
import type { ChatPanelGoalPorts, ChatPanelMessagesPorts, ChatPanelToolbarPorts } from "./ports";
import { chatPanelToolbarViewModel } from "./toolbar";

export function chatPanelToolbarRegionNode(ports: ChatPanelToolbarPorts): UiNode {
  return <ToolbarRegion ports={ports} />;
}

export function chatPanelGoalRegionNode(ports: ChatPanelGoalPorts): UiNode {
  return <GoalRegion ports={ports} />;
}

export function chatPanelMessagesRegionNode(ports: ChatPanelMessagesPorts): UiNode {
  return <MessagesRegion ports={ports} />;
}

export function chatPanelComposerRegionNode(node: () => UiNode): UiNode {
  return <ComposerRegion node={node} />;
}

function ToolbarRegion({ ports }: { ports: ChatPanelToolbarPorts }): UiNode {
  const shellState = useChatPanelShellState();
  useToolbarArchiveConfirmSubscription(ports);
  useToolbarRenameSubscription(ports);
  void shellState.renderVersion.value;
  return toolbarNode(chatPanelToolbarViewModel(ports, shellState), ports.actions.toolbar);
}

function GoalRegion({ ports }: { ports: ChatPanelGoalPorts }): UiNode {
  const { activeThread, ui, renderVersion, latestState } = useChatPanelShellState();
  const props = useComputed(() => {
    void renderVersion.value;
    return chatPanelGoalProps(ports, {
      ...latestState(),
      activeThread: activeThread.value,
      ui: ui.value,
    });
  });
  return goalBannerNode(props.value.goal, props.value.actions, props.value.options);
}

function MessagesRegion({ ports }: { ports: ChatPanelMessagesPorts }): UiNode {
  const { activeThread, runtime, messageStream, requests, turn, ui, renderVersion } = useChatPanelShellState();
  void activeThread.value;
  void runtime.value;
  void messageStream.value;
  void requests.value;
  void turn.value;
  void ui.value;
  void renderVersion.value;
  return chatPanelMessagesNode(ports);
}

function ComposerRegion({ node }: { node: () => UiNode }): UiNode {
  const { connection, threadList, activeThread, runtime, turn, messageStream, composer, renderVersion } = useChatPanelShellState();
  void connection.value;
  void threadList.value;
  void activeThread.value;
  void runtime.value;
  void turn.value;
  void messageStream.value;
  void composer.value;
  void renderVersion.value;
  return node();
}

function useToolbarArchiveConfirmSubscription(ports: ChatPanelToolbarPorts): void {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      ports.view.toolbar.archiveConfirmSubscribe(() => {
        setVersion((version) => version + 1);
      }),
    [ports],
  );
}

function useToolbarRenameSubscription(ports: ChatPanelToolbarPorts): void {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      ports.view.toolbar.renameSubscribe(() => {
        setVersion((version) => version + 1);
      }),
    [ports],
  );
}

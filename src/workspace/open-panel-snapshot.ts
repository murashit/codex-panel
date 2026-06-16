import type { ChatPanelSnapshot } from "../features/chat/panel/snapshot";

export type { ChatPanelSnapshot } from "../features/chat/panel/snapshot";

export interface OpenCodexPanelSnapshot extends ChatPanelSnapshot {
  lastFocused: boolean;
}

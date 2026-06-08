type OpenCodexPanelTurnLifecycle = { kind: "idle" } | { kind: "starting" } | { kind: "running"; turnId: string };

export interface OpenCodexPanelSnapshot {
  viewId: string;
  threadId: string | null;
  lastFocused: boolean;
  turnLifecycle: OpenCodexPanelTurnLifecycle;
  pendingApprovals: number;
  pendingUserInputs: number;
  hasComposerDraft: boolean;
  connected: boolean;
}

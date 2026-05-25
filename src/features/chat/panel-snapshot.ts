export interface OpenCodexPanelSnapshot {
  viewId: string;
  threadId: string | null;
  busy: boolean;
  activeTurnId: string | null;
  pendingApprovals: number;
  pendingUserInputs: number;
  hasComposerDraft: boolean;
  connected: boolean;
}

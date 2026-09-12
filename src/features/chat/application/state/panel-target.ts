import { type ChatState, panelThreadId } from "./model";

export interface PanelTargetLease {
  readonly revision: number;
  readonly threadId: string | null;
}

export function capturePanelTargetLease(state: ChatState): PanelTargetLease {
  return {
    revision: state.panelTargetRevision,
    threadId: panelThreadId(state) || null,
  };
}

export function panelTargetLeaseIsCurrent(state: ChatState, lease: PanelTargetLease): boolean {
  return state.panelTargetRevision === lease.revision && panelThreadId(state) === lease.threadId;
}

export function panelTargetLeasesMatch(left: PanelTargetLease, right: PanelTargetLease): boolean {
  return left.revision === right.revision && left.threadId === right.threadId;
}

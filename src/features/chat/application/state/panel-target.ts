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
  // Server ID assignment materializes the same local conversation. Explicit
  // navigation increments the revision, including a round trip to the same ID.
  return state.panelTargetRevision === lease.revision;
}

export function panelTargetLeasesMatch(left: PanelTargetLease, right: PanelTargetLease): boolean {
  return left.revision === right.revision;
}

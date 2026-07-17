import { type ChatState, panelThreadId } from "./root-reducer";

type PanelTarget = { readonly kind: "empty" } | { readonly kind: "thread"; readonly threadId: string };

export interface PanelTargetLease {
  readonly revision: number;
  readonly target: PanelTarget;
}

export function capturePanelTargetLease(state: ChatState): PanelTargetLease {
  const threadId = panelThreadId(state);
  return {
    revision: state.panelTargetRevision,
    target: threadId ? { kind: "thread", threadId } : { kind: "empty" },
  };
}

export function panelTargetLeaseIsCurrent(state: ChatState, lease: PanelTargetLease): boolean {
  if (state.panelTargetRevision !== lease.revision) return false;
  const threadId = panelThreadId(state);
  return lease.target.kind === "empty" ? threadId === null : threadId === lease.target.threadId;
}

export function panelTargetLeasesMatch(left: PanelTargetLease, right: PanelTargetLease): boolean {
  if (left.revision !== right.revision) return false;
  if (left.target.kind === "empty") return right.target.kind === "empty";
  return right.target.kind === "thread" && left.target.threadId === right.target.threadId;
}

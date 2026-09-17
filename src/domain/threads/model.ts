import type { ReasoningEffort } from "../runtime/catalog";
import type { RuntimePermissionKnownState, RuntimePermissionState } from "../runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../runtime/settings";

export interface Thread {
  readonly id: string;
  readonly preview: string;
  readonly name: string | null;
  readonly archived: boolean;
  readonly isPinned?: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recencyAt?: number | null;
  readonly provenance: ThreadProvenance;
}

export type ThreadProvenance =
  | { readonly kind: "interactive" }
  | {
      readonly kind: "subagent";
      readonly subagentKind: "thread-spawn" | "review" | "compact" | "memory-consolidation" | "other";
      readonly parentThreadId: string | null;
      readonly sessionId: string | null;
      readonly depth: number | null;
      readonly agentPath?: string | null;
      readonly agentNickname: string | null;
      readonly agentRole: string | null;
    };

export function isThreadVisibleInCatalog(thread: Pick<Thread, "provenance">): boolean {
  return thread.provenance.kind === "interactive";
}

export function explicitThreadName(thread: Thread): string | null {
  return normalizeExplicitThreadName(thread.name);
}

export function normalizeExplicitThreadName(value: string | null | undefined): string | null {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return name.length > 0 ? name : null;
}

export function threadRecencyAt(thread: Thread): number {
  return thread.recencyAt ?? thread.updatedAt;
}

export function compareThreadsPinnedFirst(left: Thread, right: Thread): number {
  return Number(right.isPinned === true) - Number(left.isPinned === true) || threadRecencyAt(right) - threadRecencyAt(left);
}

export function shortThreadId(threadId: string): string {
  return threadId.slice(0, 8);
}

export interface ThreadActivationSnapshot extends RuntimePermissionState, RuntimePermissionKnownState {
  thread: Thread;
  /**
   * Whether the activated app-server thread accepts direct turn input.
   * `null` means the capability is unavailable, so panel mode policy decides.
   */
  canAcceptDirectInput: boolean | null;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  reasoningEffort: ReasoningEffort | null;
}

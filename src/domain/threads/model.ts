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

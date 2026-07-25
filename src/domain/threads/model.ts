export interface Thread {
  readonly id: string;
  readonly preview: string;
  readonly name: string | null;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recencyAt?: number | null;
  /**
   * Whether the loaded app-server thread accepts direct turn input.
   * `null` means the capability is unavailable, so panel mode policy decides.
   */
  readonly canAcceptDirectInput?: boolean | null;
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
      readonly agentNickname: string | null;
      readonly agentRole: string | null;
    };

export function isSubagentThread(thread: Thread): boolean {
  return thread.provenance.kind === "subagent";
}

export function explicitThreadName(thread: Thread): string | null {
  return normalizeExplicitThreadName(thread.name);
}

export function normalizeExplicitThreadName(value: string | null | undefined): string | null {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return name.length > 0 ? name : null;
}

export function upsertThread(threads: readonly Thread[], thread: Thread): Thread[] {
  const index = threads.findIndex((item) => item.id === thread.id);
  if (index === -1) return [thread, ...threads];
  return threads.map((item, itemIndex) => (itemIndex === index ? { ...item, ...thread } : item));
}

export function threadRecencyAt(thread: Thread): number {
  return thread.recencyAt ?? thread.updatedAt;
}

export interface ActiveRouteScope {
  activeThreadId: string | null;
  activeTurnId: string | null;
}

export interface MessageScope {
  threadId: string | null;
  turnId: string | null;
}

export function isMessageScopeInActiveRouteScope(messageScope: MessageScope, activeScope: ActiveRouteScope): boolean {
  // Scope identifiers are filters only when both the message and the active
  // panel have one. Thread catalog and idle-thread notifications often omit
  // active turn scope, so missing ids stay eligible for the active route.
  if (messageScope.threadId && activeScope.activeThreadId && messageScope.threadId !== activeScope.activeThreadId) return false;
  if (messageScope.turnId && activeScope.activeTurnId && messageScope.turnId !== activeScope.activeTurnId) return false;
  return true;
}

export function isTurnScopedMessageForIdleActiveThread(messageScope: MessageScope, activeScope: ActiveRouteScope): boolean {
  return activeScope.activeThreadId !== null && activeScope.activeTurnId === null && messageScope.turnId !== null;
}

export function fallbackMessageScope(message: { params?: unknown }): MessageScope {
  const rawParams = message.params;
  const params =
    rawParams !== null && typeof rawParams === "object" && !Array.isArray(rawParams) ? (rawParams as Record<string, unknown>) : null;
  return {
    threadId: stringParam(params, "threadId"),
    turnId: stringParam(params, "turnId"),
  };
}

function stringParam(params: Record<string, unknown> | null, key: string): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

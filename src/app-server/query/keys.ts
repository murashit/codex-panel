export interface AppServerQueryContext {
  codexPath: string;
  vaultPath: string;
}

export interface AppServerContextLease {
  readonly context: Readonly<AppServerQueryContext>;
  readonly generation: number;
}

export interface AppServerQueryContextIdentity extends AppServerQueryContext {
  readonly generation: number;
}

type AppServerQueryScope = readonly ["app-server", number, string, string];
export type AppServerActiveThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "active"];
export type AppServerArchivedThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "archived"];
export type AppServerModelsQueryKey = readonly [...AppServerQueryScope, "models"];
export type AppServerRuntimeConfigQueryKey = readonly [...AppServerQueryScope, "runtime-config"];
export type AppServerSkillsQueryKey = readonly [...AppServerQueryScope, "skills"];
export type AppServerPermissionProfilesQueryKey = readonly [...AppServerQueryScope, "permission-profiles"];
export type AppServerRateLimitsQueryKey = readonly [...AppServerQueryScope, "rate-limits"];

export function appServerQueryContextIsComplete(context: AppServerQueryContext): boolean {
  return nonEmptyString(context.codexPath) && nonEmptyString(context.vaultPath);
}

function cloneAppServerQueryContext(context: AppServerQueryContext): AppServerQueryContext {
  return { ...context };
}

export function createAppServerContextLease(context: AppServerQueryContext, generation: number): AppServerContextLease {
  return Object.freeze({
    context: Object.freeze(cloneAppServerQueryContext(context)),
    generation,
  });
}

export function appServerQueryContextIdentity(lease: AppServerContextLease): AppServerQueryContextIdentity {
  return {
    ...lease.context,
    generation: lease.generation,
  };
}

export function cloneAppServerQueryContextIdentity(identity: AppServerQueryContextIdentity): AppServerQueryContextIdentity {
  return { ...identity };
}

export function appServerQueryContextRawEquals(left: AppServerQueryContext, right: AppServerQueryContext): boolean {
  return left.codexPath === right.codexPath && left.vaultPath === right.vaultPath;
}

function appServerQueryContextMatches(left: AppServerQueryContext, right: AppServerQueryContext): boolean {
  return appServerQueryContextIsComplete(left) && appServerQueryContextIsComplete(right) && appServerQueryContextRawEquals(left, right);
}

function appServerQueryContextKey(context: AppServerQueryContext): string {
  return `${context.codexPath}\u0000${context.vaultPath}`;
}

export function appServerQueryContextIdentityMatches(left: AppServerQueryContextIdentity, right: AppServerQueryContextIdentity): boolean {
  return left.generation === right.generation && appServerQueryContextMatches(left, right);
}

export function appServerQueryContextIdentityKey(identity: AppServerQueryContextIdentity): string {
  return `${String(identity.generation)}\u0000${appServerQueryContextKey(identity)}`;
}

function appServerQueryScope(context: AppServerQueryContextIdentity): AppServerQueryScope {
  return ["app-server", context.generation, context.codexPath, context.vaultPath];
}

export function activeThreadsQueryKey(context: AppServerQueryContextIdentity): AppServerActiveThreadsQueryKey {
  return [...appServerQueryScope(context), "threads", "active"];
}

export function archivedThreadsQueryKey(context: AppServerQueryContextIdentity): AppServerArchivedThreadsQueryKey {
  return [...appServerQueryScope(context), "threads", "archived"];
}

export function appServerModelsQueryKey(context: AppServerQueryContextIdentity): AppServerModelsQueryKey {
  return [...appServerQueryScope(context), "models"];
}

export function appServerRuntimeConfigQueryKey(context: AppServerQueryContextIdentity): AppServerRuntimeConfigQueryKey {
  return [...appServerQueryScope(context), "runtime-config"];
}

export function appServerSkillsQueryKey(context: AppServerQueryContextIdentity): AppServerSkillsQueryKey {
  return [...appServerQueryScope(context), "skills"];
}

export function appServerPermissionProfilesQueryKey(context: AppServerQueryContextIdentity): AppServerPermissionProfilesQueryKey {
  return [...appServerQueryScope(context), "permission-profiles"];
}

export function appServerRateLimitsQueryKey(context: AppServerQueryContextIdentity): AppServerRateLimitsQueryKey {
  return [...appServerQueryScope(context), "rate-limits"];
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

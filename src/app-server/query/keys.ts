import type { QueryKey } from "@tanstack/query-core";

export interface AppServerQueryContext {
  codexPath: string;
  vaultPath: string;
}

type AppServerQueryScope = readonly ["app-server", string, string];
export type AppServerActiveThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "active"];
export type AppServerMetadataQueryKey = readonly [...AppServerQueryScope, "metadata"];
export type AppServerModelsQueryKey = readonly [...AppServerQueryScope, "models"];

export function appServerQueryContextIsComplete(context: AppServerQueryContext): boolean {
  return nonEmptyString(context.codexPath) && nonEmptyString(context.vaultPath);
}

export function cloneAppServerQueryContext(context: AppServerQueryContext): AppServerQueryContext {
  return { ...context };
}

export function appServerQueryContextRawEquals(left: AppServerQueryContext, right: AppServerQueryContext): boolean {
  return left.codexPath === right.codexPath && left.vaultPath === right.vaultPath;
}

export function appServerQueryContextMatches(left: AppServerQueryContext, right: AppServerQueryContext): boolean {
  return appServerQueryContextIsComplete(left) && appServerQueryContextIsComplete(right) && appServerQueryContextRawEquals(left, right);
}

function appServerQueryScope(context: AppServerQueryContext): AppServerQueryScope {
  return ["app-server", context.codexPath, context.vaultPath];
}

export function activeThreadsQueryKey(context: AppServerQueryContext): AppServerActiveThreadsQueryKey {
  return [...appServerQueryScope(context), "threads", "active"];
}

export function appServerMetadataQueryKey(context: AppServerQueryContext): AppServerMetadataQueryKey {
  return [...appServerQueryScope(context), "metadata"];
}

export function appServerModelsQueryKey(context: AppServerQueryContext): AppServerModelsQueryKey {
  return [...appServerQueryScope(context), "models"];
}

export function appServerQueriesFilter(context: AppServerQueryContext): { queryKey: QueryKey } {
  return { queryKey: appServerQueryScope(context) };
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

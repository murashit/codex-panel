import { QueryObserver } from "@tanstack/query-core";
import { shortDiagnosticErrorMessage, upsertMcpServerDiagnostic } from "../../domain/server/diagnostics";
import {
  type McpServerAuthenticationIssue,
  type McpServerDiagnostic,
  type McpServerStartupStatus,
  mcpConnectionStatusFromStartupStatus,
} from "../../domain/server/mcp-status";
import { cloneToolInventorySnapshot, type ToolInventorySnapshot } from "../../domain/server/tool-inventory";
import {
  type InstalledPluginInventory,
  type McpServerInventory,
  readInstalledPluginInventory,
  readMcpServerInventory,
} from "../services/tool-inventory";
import type { AppServerQueryOptions, AppServerQueryScope } from "./query-scope";

const TOOL_INVENTORY_QUERY_KEY = ["tools"] as const;
const INSTALLED_PLUGINS_QUERY_KEY = [...TOOL_INVENTORY_QUERY_KEY, "plugins"] as const;
const MCP_SERVERS_QUERY_KEY = [...TOOL_INVENTORY_QUERY_KEY, "mcp-servers"] as const;
const MCP_STARTUP_DIAGNOSTICS_QUERY_KEY = [...TOOL_INVENTORY_QUERY_KEY, "mcp-startup-diagnostics"] as const;

interface McpStartupDiagnostics {
  readonly revision: number;
  readonly servers: readonly McpServerDiagnostic[];
}

export class AppServerToolInventoryQueries {
  private readonly pluginsQueryOptions: AppServerQueryOptions<InstalledPluginInventory>;
  private readonly mcpRevalidationRevisions = new Map<string | null, number>();

  constructor(private readonly scope: AppServerQueryScope) {
    this.pluginsQueryOptions = {
      queryKey: INSTALLED_PLUGINS_QUERY_KEY,
      queryFn: ({ signal }) =>
        this.scope.runWithClient((client) => readInstalledPluginInventory(client, this.scope.context.vaultPath, { signal })),
    };
  }

  snapshot(threadId: string | null): ToolInventorySnapshot | null {
    if (this.scope.isDisposed()) return null;
    const plugins = this.scope.client.getQueryState<InstalledPluginInventory>(INSTALLED_PLUGINS_QUERY_KEY);
    const mcp = this.scope.client.getQueryState<McpServerInventory>(mcpServersQueryKey(threadId));
    const globalDiagnostics = this.mcpStartupDiagnostics(null);
    const scopedDiagnostics = threadId === null ? globalDiagnostics : this.mcpStartupDiagnostics(threadId);
    if (!plugins && !mcp && globalDiagnostics.servers.length === 0 && scopedDiagnostics.servers.length === 0) return null;
    const mcpDiagnostics = scopedDiagnostics.servers.reduce(upsertMcpServerDiagnostic, globalDiagnostics.servers);
    return cloneToolInventorySnapshot({
      plugins: plugins?.data?.plugins ?? null,
      pluginMarketplaceErrors: plugins?.data?.marketplaceErrors ?? [],
      pluginsError: queryErrorMessage(plugins?.error),
      mcpServers: mcp?.data?.servers ?? null,
      mcpDiagnostics,
      mcpError: queryErrorMessage(mcp?.error),
    });
  }

  observe(threadId: string | null, listener: (snapshot: ToolInventorySnapshot | null) => void): () => void {
    this.scope.assertUsable();
    const observers = [
      new QueryObserver(this.scope.client, { ...this.pluginsQueryOptions, enabled: true }),
      new QueryObserver(this.scope.client, { ...this.mcpServersQueryOptions(threadId), enabled: true }),
      new QueryObserver(this.scope.client, { queryKey: mcpStartupDiagnosticsQueryKey(null), enabled: false }),
      ...(threadId === null
        ? []
        : [new QueryObserver(this.scope.client, { queryKey: mcpStartupDiagnosticsQueryKey(threadId), enabled: false })]),
    ];
    const emit = (): void => {
      listener(this.snapshot(threadId));
    };
    const unsubscribers = observers.map((observer) => observer.subscribe(emit));
    emit();
    return this.scope.trackObserver(() => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      for (const observer of observers) observer.destroy();
    });
  }

  async ensure(threadId: string | null): Promise<ToolInventorySnapshot> {
    this.scope.assertUsable();
    await Promise.allSettled([
      this.scope.client.query(this.pluginsQueryOptions),
      this.scope.client.query(this.mcpServersQueryOptions(threadId)),
    ]);
    this.scope.assertUsable();
    return this.snapshot(threadId) ?? emptyToolInventorySnapshot();
  }

  async refresh(threadId: string | null): Promise<ToolInventorySnapshot> {
    this.scope.assertUsable();
    await Promise.all([
      this.scope.client.invalidateQueries({ queryKey: INSTALLED_PLUGINS_QUERY_KEY, exact: true, refetchType: "none" }),
      this.scope.client.invalidateQueries({ queryKey: mcpServersQueryKey(threadId), exact: true, refetchType: "none" }),
    ]);
    return this.ensure(threadId);
  }

  handleAppListUpdated(): void {
    this.revalidateMcpServers();
  }

  handleMcpOauthLoginCompleted(threadId: string | null): void {
    this.revalidateMcpServersForThread(threadId);
  }

  handleMcpStartupStatusUpdated(input: {
    threadId: string | null;
    name: string;
    status: McpServerStartupStatus;
    error: string | null;
    failureReason: McpServerAuthenticationIssue | null;
  }): void {
    if (this.scope.isDisposed() || input.name.length === 0) return;
    const queryKey = mcpStartupDiagnosticsQueryKey(input.threadId);
    this.scope.client.setQueryData<McpStartupDiagnostics>(queryKey, (current) => ({
      revision: (current?.revision ?? 0) + 1,
      servers: upsertMcpServerDiagnostic(current?.servers ?? [], {
        name: input.name,
        connectionStatus: mcpConnectionStatusFromStartupStatus(input.status),
        authStatus: null,
        toolCount: null,
        message: input.error,
        authenticationIssue: input.failureReason,
      }),
    }));
  }

  private revalidateMcpServers(): void {
    if (this.scope.isDisposed()) return;
    const queries = this.scope.client.getQueryCache().findAll({ queryKey: MCP_SERVERS_QUERY_KEY });
    for (const query of queries) {
      this.revalidateMcpServersForThread((query.queryKey[2] as string | null | undefined) ?? null);
    }
  }

  private revalidateMcpServersForThread(threadId: string | null): void {
    if (this.scope.isDisposed()) return;
    this.mcpRevalidationRevisions.set(threadId, this.mcpRevalidationRevision(threadId) + 1);
    void this.scope.client.invalidateQueries({ queryKey: mcpServersQueryKey(threadId), exact: true }).catch(() => {
      // The resource keeps its last-known-good value and exposes the refresh error.
    });
  }

  private mcpServersQueryOptions(threadId: string | null): AppServerQueryOptions<McpServerInventory> {
    return {
      queryKey: mcpServersQueryKey(threadId),
      queryFn: async ({ signal }) => {
        for (;;) {
          const revalidationRevision = this.mcpRevalidationRevision(threadId);
          const globalRevision = this.mcpStartupDiagnostics(null).revision;
          const scopedRevision = this.mcpStartupDiagnostics(threadId).revision;
          const inventory = await this.scope.runWithClient((client) => readMcpServerInventory(client, threadId, { signal }));
          if (revalidationRevision !== this.mcpRevalidationRevision(threadId)) continue;
          if (threadId === null) this.clearMcpStartupDiagnostics(null, globalRevision);
          if (threadId !== null) this.clearMcpStartupDiagnostics(threadId, scopedRevision);
          return inventory;
        }
      },
    };
  }

  private mcpRevalidationRevision(threadId: string | null): number {
    return this.mcpRevalidationRevisions.get(threadId) ?? 0;
  }

  private mcpStartupDiagnostics(threadId: string | null): McpStartupDiagnostics {
    return this.scope.client.getQueryData<McpStartupDiagnostics>(mcpStartupDiagnosticsQueryKey(threadId)) ?? { revision: 0, servers: [] };
  }

  private clearMcpStartupDiagnostics(threadId: string | null, expectedRevision: number): void {
    const queryKey = mcpStartupDiagnosticsQueryKey(threadId);
    const current = this.scope.client.getQueryData<McpStartupDiagnostics>(queryKey);
    if (!current || current.revision !== expectedRevision || current.servers.length === 0) return;
    this.scope.client.setQueryData<McpStartupDiagnostics>(queryKey, { revision: current.revision, servers: [] });
  }
}

function mcpServersQueryKey(threadId: string | null): readonly ["tools", "mcp-servers", string | null] {
  return [...MCP_SERVERS_QUERY_KEY, threadId];
}

function mcpStartupDiagnosticsQueryKey(threadId: string | null): readonly ["tools", "mcp-startup-diagnostics", string | null] {
  return [...MCP_STARTUP_DIAGNOSTICS_QUERY_KEY, threadId];
}

function queryErrorMessage(error: unknown): string | null {
  return error ? shortDiagnosticErrorMessage(error) : null;
}

function emptyToolInventorySnapshot(): ToolInventorySnapshot {
  return {
    plugins: null,
    pluginMarketplaceErrors: [],
    pluginsError: null,
    mcpServers: null,
    mcpDiagnostics: [],
    mcpError: null,
  };
}

import { QueryObserver } from "@tanstack/query-core";
import { shortDiagnosticErrorMessage } from "../../domain/runtime/diagnostics";
import {
  type McpServerAuthenticationIssue,
  type McpServerDiagnostic,
  type McpServerRegistration,
  type McpServerStartupStatus,
  mcpServerRegistrationKey,
  type ToolInventorySnapshot,
} from "../../domain/runtime/tool-inventory";
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

type McpStartupDiagnostics = ReadonlyMap<string, McpServerDiagnostic>;

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
    const scopedDiagnostics = threadId === null ? undefined : this.mcpStartupDiagnostics(threadId);
    const diagnostics = new Map([...(globalDiagnostics ?? []), ...(scopedDiagnostics ?? [])]);
    if (!plugins && !mcp && diagnostics.size === 0) return null;
    return {
      plugins: plugins?.data?.plugins ?? null,
      pluginsError: queryErrorMessage(plugins?.error),
      mcpServers: mcp?.data?.servers ?? null,
      mcpDiagnostics: [...diagnostics.values()].sort((a, b) => a.name.localeCompare(b.name)),
      mcpError: queryErrorMessage(mcp?.error),
    };
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
    for (const observer of observers) observer.subscribe(emit);
    emit();
    return this.scope.trackObserver(() => {
      for (const observer of observers) observer.destroy();
    });
  }

  observeMcpRegistrations(threadId: string, listener: (registrations: readonly McpServerRegistration[] | null) => void): () => void {
    this.scope.assertUsable();
    const observer = new QueryObserver(this.scope.client, { ...this.mcpServersQueryOptions(threadId), refetchOnMount: "always" });
    const emit = (): void => {
      const result = observer.getCurrentResult();
      listener(result.isSuccess && !result.isFetching && !result.isStale ? result.data.servers : null);
    };
    observer.subscribe(emit);
    emit();
    return this.scope.trackObserver(() => {
      observer.destroy();
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
    environmentId: string | null;
    status: McpServerStartupStatus;
    error: string | null;
    failureReason: McpServerAuthenticationIssue | null;
  }): void {
    if (this.scope.isDisposed() || input.name.length === 0) return;
    const diagnostic: McpServerDiagnostic = {
      name: input.name,
      environmentId: input.environmentId,
      connectionStatus: input.status === "ready" ? "connected" : input.status,
      message: input.error,
      authenticationIssue: input.failureReason,
    };
    this.scope.client.setQueryData<McpStartupDiagnostics>(mcpStartupDiagnosticsQueryKey(input.threadId), (current) =>
      new Map(current).set(mcpServerRegistrationKey(diagnostic), diagnostic),
    );
  }

  private revalidateMcpServers(): void {
    if (this.scope.isDisposed()) return;
    const queries = this.scope.client.getQueryCache().findAll({ queryKey: MCP_SERVERS_QUERY_KEY });
    for (const query of queries) {
      const threadId = query.queryKey[2];
      this.revalidateMcpServersForThread(typeof threadId === "string" ? threadId : null);
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
          const startup = this.mcpStartupDiagnostics(threadId);
          const inventory = await this.scope.runWithClient((client) => readMcpServerInventory(client, threadId, { signal }));
          if (revalidationRevision !== this.mcpRevalidationRevision(threadId)) continue;
          // Every startup notification installs a new map, including an identical notification during a refresh.
          if (startup?.size && startup === this.mcpStartupDiagnostics(threadId)) {
            this.scope.client.setQueryData<McpStartupDiagnostics>(mcpStartupDiagnosticsQueryKey(threadId), new Map());
          }
          return inventory;
        }
      },
    };
  }

  private mcpRevalidationRevision(threadId: string | null): number {
    return this.mcpRevalidationRevisions.get(threadId) ?? 0;
  }

  private mcpStartupDiagnostics(threadId: string | null): McpStartupDiagnostics | undefined {
    return this.scope.client.getQueryData<McpStartupDiagnostics>(mcpStartupDiagnosticsQueryKey(threadId));
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
    pluginsError: null,
    mcpServers: null,
    mcpDiagnostics: [],
    mcpError: null,
  };
}

import type { AppServerClient } from "../../../../app-server/connection/client";
import { readRateLimitMetadataProbe } from "../../../../app-server/query/metadata-probes";
import { listModelMetadata } from "../../../../app-server/services/catalog";
import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import { readToolInventory } from "../../../../app-server/services/tool-inventory";
import type { DiagnosticProbeId, DiagnosticProbeResult } from "../../../../domain/server/diagnostics";
import { diagnosticProbeError, diagnosticProbeOk } from "../../../../domain/server/diagnostics";
import type { ServerDiagnosticsSnapshot, ServerDiagnosticsTransport } from "../../application/connection/metadata-transport";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ChatAppServerMetadataTransportHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

export interface ChatMetadataTransports {
  readonly serverDiagnostics: ServerDiagnosticsTransport;
}

interface DiagnosticProbeSnapshot {
  probe: DiagnosticProbeResult;
}

export function createChatMetadataTransports(host: ChatAppServerMetadataTransportHost): ChatMetadataTransports {
  return {
    serverDiagnostics: createChatServerDiagnosticsTransport(host),
  };
}

function createChatServerDiagnosticsTransport(host: ChatAppServerMetadataTransportHost): ServerDiagnosticsTransport {
  return {
    readServerDiagnostics: async (request): Promise<ServerDiagnosticsSnapshot | null> => {
      const client = host.currentClient();
      if (!client) return null;
      const toolInventory = readToolInventory(client, host.vaultPath, {
        threadId: request.threadId,
        mcpDiagnostics: request.initialDiagnostics.mcpServers,
        ...(request.cachedSkills !== undefined ? { cachedSkills: request.cachedSkills } : {}),
        ...(request.cachedSkillsProbe !== undefined ? { cachedSkillsProbe: request.cachedSkillsProbe } : {}),
      });
      const probes: Promise<DiagnosticProbeSnapshot>[] = [];
      if (request.forceResourceProbes && !request.appServerMetadataSnapshot) {
        probes.push(
          probeDiagnostic(
            "models",
            () => listModelMetadata(client),
            (models) => `${String(models.length)} models`,
          ),
          readRateLimitDiagnosticProbe(client),
        );
      }

      const [resourceProbes, toolInventoryResult] = await Promise.all([Promise.all(probes), toolInventory]);
      if (host.currentClient() !== client) return null;
      return {
        resourceProbes: resourceProbes.map((result) => result.probe),
        toolInventory: toolInventoryResult,
      };
    },
  };
}

async function readRateLimitDiagnosticProbe(client: AppServerRequestClient): Promise<DiagnosticProbeSnapshot> {
  const result = await readRateLimitMetadataProbe(client);
  return { probe: result.probe };
}

async function probeDiagnostic<T>(
  id: DiagnosticProbeId,
  request: () => Promise<T>,
  summarize: (response: T) => string | null,
): Promise<DiagnosticProbeSnapshot> {
  try {
    const response = await request();
    return {
      probe: diagnosticProbeOk(id, summarize(response), Date.now()),
    };
  } catch (error) {
    return { probe: diagnosticProbeError(id, error, Date.now()) };
  }
}

import type { AppServerClient } from "../../../../app-server/connection/client";
import { listModelMetadata } from "../../../../app-server/services/catalog";
import { readRateLimitMetadataProbe } from "../../../../app-server/services/metadata-probes";
import { readToolInventory } from "../../../../app-server/services/tool-inventory";
import type { DiagnosticProbeId, DiagnosticProbeResult } from "../../../../domain/server/diagnostics";
import { diagnosticProbeError, diagnosticProbeOk } from "../../../../domain/server/diagnostics";
import type { ServerDiagnosticsPort, ServerDiagnosticsSnapshot } from "../../application/connection/metadata-port";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ChatAppServerMetadataAdapterHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

export function createChatServerDiagnosticsAdapter(host: ChatAppServerMetadataAdapterHost): ServerDiagnosticsPort {
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
      const probes: Promise<DiagnosticProbeResult>[] = [];
      if (request.forceResourceProbes && !request.appServerMetadataSnapshot) {
        probes.push(
          probeDiagnostic(
            "models",
            () => listModelMetadata(client),
            (models) => `${String(models.length)} models`,
          ),
          readRateLimitMetadataProbe(client).then((result) => result.probe),
        );
      }

      const [resourceProbes, toolInventoryResult] = await Promise.all([Promise.all(probes), toolInventory]);
      if (host.currentClient() !== client) return null;
      return {
        resourceProbes,
        toolInventory: toolInventoryResult,
      };
    },
  };
}

async function probeDiagnostic<T>(
  id: DiagnosticProbeId,
  request: () => Promise<T>,
  summarize: (response: T) => string | null,
): Promise<DiagnosticProbeResult> {
  try {
    const response = await request();
    return diagnosticProbeOk(id, summarize(response), Date.now());
  } catch (error) {
    return diagnosticProbeError(id, error, Date.now());
  }
}

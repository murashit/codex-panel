import { CLIENT_VERSION } from "../../constants";
import type { InitializeCapabilities } from "../../generated/app-server/InitializeCapabilities";
import type { InitializeParams } from "../../generated/app-server/InitializeParams";
import compatibility from "./compatibility.json";

interface AppServerCompatibility {
  codexAppServer: {
    typeGeneration: {
      experimental: boolean;
    };
    initialize: {
      capabilities: Pick<InitializeCapabilities, "experimentalApi" | "requestAttestation">;
    };
  };
}

const appServerCompatibility = compatibility satisfies AppServerCompatibility;

export function codexPanelAppServerInitializeParams(): InitializeParams {
  return {
    clientInfo: {
      name: "obsidian_codex_panel",
      title: "Codex Panel",
      version: CLIENT_VERSION,
    },
    capabilities: {
      experimentalApi: appServerCompatibility.codexAppServer.initialize.capabilities.experimentalApi,
      requestAttestation: appServerCompatibility.codexAppServer.initialize.capabilities.requestAttestation,
    },
  };
}

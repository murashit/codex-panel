import type { InitializeResponse as AppServerInitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ServerInitialization } from "../../domain/server/initialization";

export type AppServerInitialization = ServerInitialization;

export function appServerInitializationFromResponse(response: AppServerInitializeResponse): AppServerInitialization {
  return {
    userAgent: response.userAgent,
    codexHome: response.codexHome,
    platformFamily: response.platformFamily,
    platformOs: response.platformOs,
  };
}

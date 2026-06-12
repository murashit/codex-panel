import type { InitializeResponse as AppServerInitializeResponse } from "../../generated/app-server/InitializeResponse";
import type { ServerInitialization } from "../../domain/server/initialization";

export function appServerInitializationFromResponse(response: AppServerInitializeResponse): ServerInitialization {
  return {
    userAgent: response.userAgent,
    codexHome: response.codexHome,
    platformFamily: response.platformFamily,
    platformOs: response.platformOs,
  };
}

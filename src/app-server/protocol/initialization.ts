import type { ServerInitialization } from "../../domain/server/initialization";

interface AppServerInitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export function appServerInitializationFromResponse(response: AppServerInitializeResponse): ServerInitialization {
  return {
    userAgent: response.userAgent,
    codexHome: response.codexHome,
    platformFamily: response.platformFamily,
    platformOs: response.platformOs,
  };
}

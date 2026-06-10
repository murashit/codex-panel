import type { InitializeResponse as AppServerInitializeResponse } from "../generated/app-server/InitializeResponse";

export interface AppServerInitialization {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export function appServerInitializationFromResponse(response: AppServerInitializeResponse): AppServerInitialization {
  return {
    userAgent: response.userAgent,
    codexHome: response.codexHome,
    platformFamily: response.platformFamily,
    platformOs: response.platformOs,
  };
}

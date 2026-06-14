export const STATUS_RECONNECTING = "Reconnecting...";
export const STATUS_CONNECTION_STOPPED = "Codex app-server stopped.";
export const STATUS_CONNECTION_STARTING = "Starting Codex app-server...";
export const STATUS_CONNECTED = "Connected.";
export const STATUS_CONNECTION_FAILED = "Connection failed.";

export function missingCommandConnectionErrorMessage(errorMessage: string, configuredCommand: string): string {
  return `Could not start Codex app-server because the configured command was not found: ${configuredCommand}. Check the Codex command path in settings. (${errorMessage})`;
}

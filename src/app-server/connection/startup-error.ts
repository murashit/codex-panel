import { AppServerRequestTimeoutError } from "./json-rpc-client";

class AppServerStartupError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AppServerStartupError";
  }
}

const RECONNECT_GUIDANCE = "Use /reconnect in an editable chat. For a subagent, reconnect its parent chat and select the subagent again.";
const DIAGNOSTIC_GUIDANCE = "If it fails again, use /doctor in the editable chat for connection details.";

export function startupExitError(diagnostic: string | null): Error {
  return new AppServerStartupError(
    diagnostic ?? `Codex stopped before the connection was ready. ${RECONNECT_GUIDANCE} ${DIAGNOSTIC_GUIDANCE}`,
  );
}

// Match complete fatal diagnostics from the supported CLI, never keywords or raw logs.
export function startupDiagnostic(message: string): string | null {
  switch (message.trim()) {
    case "Error: authentication requirements do not permit any usable login method":
      return "Codex cannot use any sign-in method permitted by its requirements. Check the sign-in requirements in your Codex configuration, or ask your administrator if it is managed.";
    case "Error: windows.require_mxc = true requires MXC to be selected on this Windows host":
      return "Codex requires the MXC Windows sandbox, but it is not selected. Check the Codex sandbox configuration, or ask your administrator if it is managed.";
    case 'Error: approval_policy = "untrusted" is no longer supported; remove this setting':
      return "Codex no longer supports the configured ‘untrusted’ approval policy. Check the approval policy in your Codex configuration.";
    default:
      return null;
  }
}

export function startupError(error: unknown): AppServerStartupError {
  if (error instanceof AppServerStartupError) return error;
  let message: string;
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "ENOENT" || code === "ENOTDIR") {
    // Spawn errors do not identify the missing component. The vault is already open in Obsidian;
    // guide the user to the configurable launch command without probing paths after the failure.
    message =
      "Obsidian could not start Codex. Check that the Codex CLI is installed, then set ‘Codex executable’ in Settings → Codex Panel to its absolute path.";
  } else if (code === "EACCES" || code === "EPERM") {
    message = "Obsidian was denied access while starting Codex. Check permission to run the Codex executable and access the vault folder.";
  } else if (error instanceof AppServerRequestTimeoutError) {
    message = `Codex did not finish connecting. ${RECONNECT_GUIDANCE}`;
  } else {
    message = `Could not connect to Codex. ${RECONNECT_GUIDANCE} ${DIAGNOSTIC_GUIDANCE}`;
  }
  return new AppServerStartupError(message, error);
}

import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ConnectionStartupError } from "../../domain/runtime/connection-failure";
import { AppServerRequestTimeoutError, AppServerRpcError } from "./json-rpc-client";

/** Exact fatal diagnostics from the supported CLI, not keyword-based policy inference. */
export function startupDiagnostic(line: string): ConnectionStartupError | null {
  switch (line.trim()) {
    case "Error: authentication requirements do not permit any usable login method":
      return new ConnectionStartupError("authentication");
    case "Error: windows.require_mxc = true requires MXC to be selected on this Windows host":
      return new ConnectionStartupError("windowsSandbox");
    case 'Error: approval_policy = "untrusted" is no longer supported; remove this setting':
      return new ConnectionStartupError("retiredApprovalPolicy");
    default:
      return null;
  }
}

export async function startupFailure(error: unknown, codexPath: string, cwd: string): Promise<ConnectionStartupError> {
  if (error instanceof ConnectionStartupError) return error;
  if (error instanceof AppServerRequestTimeoutError) return new ConnectionStartupError("timeout", error);
  if (error instanceof AppServerRpcError) return new ConnectionStartupError("rejected", error);
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ENOENT" || code === "ENOTDIR") {
    // spawn reports ENOENT both for a missing executable and for a missing cwd.
    if (await pathMissing(cwd)) return new ConnectionStartupError("vault", error);
    if (isAbsolute(codexPath) && (await pathMissing(codexPath))) return new ConnectionStartupError("executable", error);
    return new ConnectionStartupError("missingPath", error);
  }
  if (code === "EACCES" || code === "EPERM") return new ConnectionStartupError("access", error);
  return new ConnectionStartupError("unknown", error);
}

async function pathMissing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

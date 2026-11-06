const STARTUP_MESSAGES = {
  executable: "The configured Codex executable was not found. Check ‘Codex executable’ in the plugin settings.",
  vault: "The vault folder is unavailable. Check that the vault is still accessible, then use /reconnect.",
  missingPath:
    "Codex could not start because a required file or folder was not found. Check ‘Codex executable’ in the plugin settings and that the vault is accessible.",
  access: "Obsidian was denied access while starting Codex. Check access to the Codex executable and the vault folder.",
  authentication:
    "Codex cannot use a permitted sign-in method. Check the sign-in requirements in your Codex configuration, or ask your administrator if it is managed.",
  windowsSandbox:
    "Codex requires the MXC Windows sandbox, but it is not selected. Check the Codex sandbox configuration with your administrator.",
  retiredApprovalPolicy:
    "Codex no longer supports the ‘untrusted’ approval policy in its configuration. Review the approval policy in your Codex configuration, or ask your administrator if it is managed.",
  timeout: "Codex did not finish connecting. Use /reconnect to try again.",
  rejected: "Codex rejected the connection setup. Check that ‘Codex executable’ points to a supported Codex CLI version.",
  exited:
    "Codex stopped before the connection was ready. Use /reconnect to try again. If this repeats, run /doctor and include its details when reporting the problem.",
  unknown:
    "Could not connect to Codex. Use /reconnect to try again. If this repeats, run /doctor and include its details when reporting the problem.",
} as const;

type StartupFailureReason = keyof typeof STARTUP_MESSAGES;

export class ConnectionStartupError extends Error {
  constructor(
    readonly reason: StartupFailureReason,
    cause?: unknown,
  ) {
    super(STARTUP_MESSAGES[reason], { cause });
    this.name = "ConnectionStartupError";
  }
}

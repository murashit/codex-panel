export interface AuthRecoveryProgress {
  readonly message: string;
  readonly phase: "running" | "completed";
}

export function authRecoveryProgress(provider: unknown, message: unknown, phase: AuthRecoveryProgress["phase"]): AuthRecoveryProgress {
  const normalizedProvider = typeof provider === "string" ? provider.trim() || null : null;
  const normalizedMessage = typeof message === "string" ? message.trim() : "";
  return {
    message: normalizedMessage || fallbackAuthRecoveryMessage(normalizedProvider, phase),
    phase,
  };
}

function fallbackAuthRecoveryMessage(provider: string | null, phase: AuthRecoveryProgress["phase"]): string {
  if (phase === "running") return provider ? `Refreshing credentials for ${provider}...` : "Refreshing credentials...";
  return provider ? `Credentials refreshed for ${provider}.` : "Credentials refreshed.";
}

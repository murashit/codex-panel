export function isLocalUserMessageId(id: string): boolean {
  return id.startsWith("local-user-") || id.startsWith("local-steer-");
}

export function isLocalSteerMessageClientId(id: string | null | undefined): boolean {
  return id?.startsWith("local-steer-") ?? false;
}

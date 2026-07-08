export function isLocalUserDialogueId(id: string): boolean {
  return id.startsWith("local-user-") || id.startsWith("local-steer-");
}

export function isLocalSteerDialogueClientId(id: string | null | undefined): boolean {
  return id?.startsWith("local-steer-") ?? false;
}

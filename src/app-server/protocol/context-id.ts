export function contextIdPart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  return safe || "context";
}

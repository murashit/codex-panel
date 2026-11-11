export function isObjectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

import { isObjectValue } from "../../../domain/objects/object-value";

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isObjectValue(value) ? value : null;
}

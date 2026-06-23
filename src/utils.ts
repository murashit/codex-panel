export { definedProp } from "./shared/object/defined-prop";
export { jsonPreview, truncate } from "./shared/text/preview";
export { shortThreadId } from "./shared/id/thread-id";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

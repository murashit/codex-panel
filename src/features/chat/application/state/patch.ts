export function patchObject<T extends object>(current: T, patch: Partial<T>): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Keys are only used to compare runtime property values with Object.is, not to assume a narrower value type.
  if (Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof T], value))) return current;
  return { ...current, ...patch };
}

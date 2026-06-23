export function definedProp<Key extends string, Value>(
  key: Key,
  value: Value | null | undefined,
): Record<Key, Value> | Record<string, never> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

export function definedProp<Key extends string, Value>(key: Key, value: Value | null | undefined): Partial<Record<Key, Value>> {
  return definedPatch(key, value ?? undefined);
}

export function definedPatch<Key extends string, Value>(key: Key, value: Value | undefined): Partial<Record<Key, Value>> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The computed property is one of Key with a Value; other keys are optional, including when Key is a union.
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<Key, Value>>);
}

export function yamlFrontmatterString(value: string): string {
  return JSON.stringify(value);
}

export function yamlFrontmatterInlineList(values: readonly string[]): string {
  return `[${values.map(yamlFrontmatterString).join(", ")}]`;
}

export function markdownCodeSpan(text: string): string {
  if (!text.includes("`")) return `\`${text}\``;
  const longestRun = Math.max(...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const delimiter = "`".repeat(longestRun + 1);
  return `${delimiter} ${text} ${delimiter}`;
}

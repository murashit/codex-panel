import { backtickDelimiter } from "../../../../domain/text/markdown";

export function markdownCodeSpan(text: string): string {
  const delimiter = backtickDelimiter(text, 1);
  if (delimiter.length === 1) return `\`${text}\``;
  return `${delimiter} ${text} ${delimiter}`;
}

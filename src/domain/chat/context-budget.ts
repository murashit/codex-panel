const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function splitUtf8Context(value: string, maxBytes: number, maxParts: number): { parts: string[]; includedBytes: number } {
  const parts: string[] = [];
  let rest = value;
  while (rest && parts.length < maxParts) {
    const prefix = utf8Prefix(rest, maxBytes);
    if (!prefix) break;
    const boundary = preferredBoundary(prefix, rest.length > prefix.length);
    const part = prefix.slice(0, boundary);
    parts.push(part);
    rest = rest.slice(part.length);
  }
  return { parts, includedBytes: parts.reduce((total, part) => total + utf8ByteLength(part), 0) };
}

export function truncateUtf8(value: string, maxBytes: number): string {
  return utf8Prefix(value, maxBytes);
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || !value) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = safeCodeUnitBoundary(value, middle);
    if (utf8ByteLength(value.slice(0, candidate)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, safeCodeUnitBoundary(value, low));
}

function safeCodeUnitBoundary(value: string, index: number): number {
  if (index <= 0 || index >= value.length) return index;
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index;
}

function preferredBoundary(prefix: string, hasRemainder: boolean): number {
  if (!hasRemainder) return prefix.length;
  const minimum = Math.floor(prefix.length / 2);
  for (const marker of ["\n\n", "\n", " "]) {
    const index = prefix.lastIndexOf(marker);
    if (index >= minimum) return index + marker.length;
  }
  return prefix.length;
}

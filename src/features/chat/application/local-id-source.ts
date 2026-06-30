export interface LocalIdSource {
  next(prefix: string): string;
}

interface LocalIdSourceOptions {
  nowMs?: () => number;
  seed?: string;
}

let sourceSequence = 0;

export function createLocalIdSource(options: LocalIdSourceOptions = {}): LocalIdSource {
  const nowMs = options.nowMs ?? Date.now;
  const seed = sanitizeIdPart(options.seed ?? Date.now().toString(36));
  sourceSequence += 1;
  const sourceId = `${seed}-${sourceSequence.toString(36)}`;
  let itemSequence = 0;
  return {
    next(prefix: string): string {
      const idPrefix = sanitizeIdPart(prefix);
      itemSequence += 1;
      return `${idPrefix}-${String(nowMs())}-${sourceId}-${itemSequence.toString(36)}`;
    },
  };
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "local";
}

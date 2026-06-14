export interface LocalChatItemIdFactory {
  next(prefix: string): string;
}

export interface LocalChatItemIdFactoryOptions {
  nowMs?: () => number;
  seed?: string;
}

let factorySequence = 0;

export function createLocalChatItemIdFactory(options: LocalChatItemIdFactoryOptions = {}): LocalChatItemIdFactory {
  const nowMs = options.nowMs ?? Date.now;
  const seed = sanitizeIdPart(options.seed ?? defaultIdSeed());
  factorySequence += 1;
  const factoryId = `${seed}-${factorySequence.toString(36)}`;
  let itemSequence = 0;
  return {
    next(prefix: string): string {
      itemSequence += 1;
      return `${prefix}-${String(nowMs())}-${factoryId}-${itemSequence.toString(36)}`;
    },
  };
}

export function isLocalUserMessageId(id: string): boolean {
  return id.startsWith("local-user-") || id.startsWith("local-steer-");
}

export function isLocalSteerMessageClientId(id: string | null | undefined): boolean {
  return id?.startsWith("local-steer-") ?? false;
}

function defaultIdSeed(): string {
  return Date.now().toString(36);
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "local";
}

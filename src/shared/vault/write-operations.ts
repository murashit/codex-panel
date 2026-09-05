export interface VaultPathDestination {
  readonly writeLockKey?: object;
  normalizePath(path: string): string;
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
}

export interface VaultMarkdownDestination extends VaultPathDestination {
  createMarkdownFile(path: string, content: string): Promise<void>;
}

const writeTails = new WeakMap<object, Promise<void>>();

export async function withVaultWriteLock<T>(destination: VaultPathDestination, operation: () => Promise<T>): Promise<T> {
  const key = destination.writeLockKey ?? destination;
  const previous = writeTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  writeTails.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeTails.get(key) === tail) writeTails.delete(key);
  }
}

const DEFAULT_FIRST_COLLISION_SUFFIX = 2;

export async function ensureVaultFolder(destination: VaultPathDestination, folder: string): Promise<void> {
  const segments = folder.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join("/");
    if (!(await destination.exists(path))) await destination.createFolder(path);
  }
}

export async function uniqueVaultPath(
  destination: Pick<VaultPathDestination, "normalizePath" | "exists">,
  folder: string,
  filename: string,
): Promise<string> {
  const { stem, extension } = splitVaultFilename(filename);
  let candidate = destination.normalizePath(`${folder}/${filename}`);
  let suffix = DEFAULT_FIRST_COLLISION_SUFFIX;
  while (await destination.exists(candidate)) {
    candidate = destination.normalizePath(`${folder}/${stem} ${String(suffix)}${extension}`);
    suffix += 1;
  }
  return candidate;
}

function splitVaultFilename(filename: string): { stem: string; extension: string } {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: filename, extension: "" };
  return {
    stem: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

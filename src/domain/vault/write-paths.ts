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

export interface VaultRelativeFolderPathOptions {
  normalizePath(path: string): string;
  emptyPathMessage: string;
  absolutePathMessage: string;
  relativeSegmentMessage: string;
  emptyFallback?: string;
}

const DEFAULT_FIRST_COLLISION_SUFFIX = 2;
const UNSAFE_VAULT_PATH_CHARS = '<>:"/\\|?*[]#^';

export function vaultRelativeFolderPath(value: string, options: VaultRelativeFolderPathOptions): string {
  const trimmed = value.trim();
  if (!trimmed) return vaultFolderFallback(options);

  const raw = trimmed.replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new Error(options.absolutePathMessage);

  const rawSegments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (rawSegments.length === 0) return vaultFolderFallback(options);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) throw new Error(options.relativeSegmentMessage);

  const folder = options.normalizePath(rawSegments.map(sanitizeVaultPathSegment).filter(Boolean).join("/"));
  if (!folder) return vaultFolderFallback(options);
  if (folder.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(options.relativeSegmentMessage);
  return folder;
}

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

export function sanitizeVaultPathSegment(value: string): string {
  return value
    .split("")
    .map((char) => (isUnsafeVaultPathChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 120)
    .trim();
}

function vaultFolderFallback(options: VaultRelativeFolderPathOptions): string {
  if (options.emptyFallback === undefined) throw new Error(options.emptyPathMessage);
  return options.normalizePath(options.emptyFallback);
}

function isUnsafeVaultPathChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || UNSAFE_VAULT_PATH_CHARS.includes(char);
}

function splitVaultFilename(filename: string): { stem: string; extension: string } {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: filename, extension: "" };
  return {
    stem: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

import { fitVaultFilename, splitVaultFilename } from "../../domain/files/vault-write-paths";
import { createKeyedOperationCoordinator } from "../async/keyed-operation-coordinator";

export interface VaultPathDestination {
  readonly writeLockKey?: object;
  normalizePath(path: string): string;
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
}

export interface VaultMarkdownDestination extends VaultPathDestination {
  createMarkdownFile(path: string, content: string): Promise<void>;
}

const writeQueues = createKeyedOperationCoordinator<object>({ whenBusy: "queue" });

export function withVaultWriteLock<T>(destination: VaultPathDestination, operation: () => Promise<T>): Promise<T> {
  return writeQueues.run(destination.writeLockKey ?? destination, operation);
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
    const marker = ` ${String(suffix)}`;
    const numbered = fitVaultFilename(stem, extension, marker, filename.length + marker.length);
    candidate = destination.normalizePath(`${folder}/${numbered}`);
    suffix += 1;
  }
  return candidate;
}

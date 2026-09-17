import * as nodePath from "node:path";

export interface VaultRelativePathOptions {
  allowRelative?: boolean;
}

export function vaultRelativePath(vaultPath: string, path: string, options: VaultRelativePathOptions = {}): string | null {
  const pathApi = pathApiFor(vaultPath, path);
  const normalizedPath = normalizedPathForApi(path, pathApi);
  if (!normalizedPath) return null;
  if (!pathApi.isAbsolute(normalizedPath)) {
    return options.allowRelative === true && !relativePathEscapesRoot(normalizedPath, pathApi) ? portablePath(normalizedPath) : null;
  }

  const normalizedVaultPath = normalizedPathForApi(vaultPath, pathApi);
  if (!normalizedVaultPath || !pathApi.isAbsolute(normalizedVaultPath)) return null;
  const relativePath = pathApi.relative(normalizedVaultPath, normalizedPath);
  if (!relativePath || relativePathEscapesRoot(relativePath, pathApi)) return null;
  return portablePath(relativePath);
}

export function pathRelativeToRoot(path: string, root?: string | null): string {
  const pathApi = pathApiFor(path, root ?? "");
  const normalizedPath = normalizedPathForApi(path, pathApi);
  const normalizedRoot = normalizedPathForApi(root ?? "", pathApi);
  if (!normalizedRoot) return portablePath(normalizedPath);
  if (pathApi.isAbsolute(normalizedPath) !== pathApi.isAbsolute(normalizedRoot)) return portablePath(normalizedPath);

  const relativePath = pathApi.relative(normalizedRoot, normalizedPath);
  if (!relativePath) return ".";
  return relativePathEscapesRoot(relativePath, pathApi) ? portablePath(normalizedPath) : portablePath(relativePath);
}

export function isFilesystemAbsolutePath(path: string): boolean {
  return pathApiFor(path).isAbsolute(path);
}

export function isVaultConfigPath(path: string, configDir: string, filesystemRoot?: string): boolean {
  const pathApi = pathApiFor(filesystemRoot ?? path, path, configDir);
  const normalizedPath = normalizedPathForApi(path, pathApi);
  const normalizedConfigDir = normalizedPathForApi(configDir, pathApi);
  if (!normalizedPath || !normalizedConfigDir) return false;
  const relativePath = pathApi.relative(normalizedConfigDir, normalizedPath);
  return !relativePath || !relativePathEscapesRoot(relativePath, pathApi);
}

export function normalizeFilePath(path: string): string {
  return portablePath(normalizedPathForApi(path, pathApiFor(path)));
}

type PathApi = typeof nodePath.posix;

function pathApiFor(...paths: string[]): PathApi {
  return paths.some(isWindowsPath) ? nodePath.win32 : nodePath.posix;
}

function isWindowsPath(path: string): boolean {
  return /^[a-z]:/i.test(path) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(path) || path.includes("\\");
}

function normalizedPathForApi(path: string, pathApi: PathApi): string {
  if (!path) return "";
  const normalizedPath = pathApi.normalize(path);
  return normalizedPath === pathApi.parse(normalizedPath).root ? normalizedPath : normalizedPath.replace(/[\\/]+$/, "");
}

function relativePathEscapesRoot(path: string, pathApi: PathApi): boolean {
  return (
    path === ".." ||
    path.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(path) ||
    (pathApi === nodePath.win32 && /^[a-z]:/i.test(path))
  );
}

function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

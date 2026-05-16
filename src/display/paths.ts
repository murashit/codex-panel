export function pathRelativeToRoot(path: string, root?: string | null): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedRoot = root?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return ".";
  return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath;
}

export function pathsRelativeToRoot(paths: string[], root?: string | null): string[] {
  return paths.map((path) => pathRelativeToRoot(path, root));
}

import { pathRelativeToRoot as sharedPathRelativeToRoot } from "../../../../../shared/path/file-paths";

export function pathRelativeToRoot(path: string, root?: string | null): string {
  return sharedPathRelativeToRoot(path, root);
}

export function pathsRelativeToRoot(paths: string[], root?: string | null): string[] {
  return paths.map((path) => pathRelativeToRoot(path, root));
}

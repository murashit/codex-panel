export interface ParsedFileHref {
  path: string;
  subpath: string;
}

export function parseFileHref(href: string): ParsedFileHref | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (isExternalFileHref(trimmed)) return null;

  const fragmentIndex = trimmed.indexOf("#");
  const withoutFragment = fragmentIndex === -1 ? trimmed : trimmed.slice(0, fragmentIndex);
  if (!withoutFragment) return null;

  const path = decodeFileHref(withoutFragment.replace(/:(\d+)(?::\d+)?$/, ""));
  const subpath = fragmentIndex === -1 ? "" : decodeFileHref(trimmed.slice(fragmentIndex));
  return path ? { path, subpath } : null;
}

function isExternalFileHref(href: string): boolean {
  if (/^[a-z]:[\\/]/i.test(href) || /^\\\\[^\\]/.test(href)) return false;
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//");
}

function decodeFileHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

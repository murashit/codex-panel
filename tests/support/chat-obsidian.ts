import { vi } from "vitest";

export function chatVaultFixture() {
  return {
    on: vi.fn(() => ({})),
    offref: vi.fn(),
    getFiles: vi.fn(() => []),
    getMarkdownFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(() => null),
  };
}

export function chatMetadataCacheFixture() {
  return {
    on: vi.fn(() => ({})),
    offref: vi.fn(),
    getFirstLinkpathDest: vi.fn(() => null),
    fileToLinktext: vi.fn((_file?: unknown, _sourcePath?: string) => ""),
    getFileCache: vi.fn(() => null),
  };
}

export function chatWorkspaceFixture() {
  return {
    getActiveFile: vi.fn(() => null),
    getActiveViewOfType: vi.fn(() => null),
    getLastOpenFiles: vi.fn(() => []),
    on: vi.fn(() => ({})),
    offref: vi.fn(),
    openLinkText: vi.fn(),
  };
}

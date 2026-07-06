import type { App } from "obsidian";

import {
  ensureVaultFolder,
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  vaultRelativeFolderPath,
} from "../../../../domain/vault/write-paths";
import { DEFAULT_ATTACHMENT_FOLDER } from "../../../../settings/model";
import { createObsidianVaultPathDestination } from "../../../../shared/obsidian/vault-write-destination.obsidian";
import type { ComposerAttachment, ComposerAttachmentHandler } from "../../application/composer/attachments";

interface VaultComposerAttachmentHandlerOptions {
  app: App;
  attachmentFolder: () => string;
  now?: () => Date;
}

const GENERATED_ATTACHMENT_PREFIX = "codex-panel";
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"]);
const MIME_EXTENSION_BY_TYPE: ReadonlyMap<string, string> = new Map([
  ["application/pdf", "pdf"],
  ["application/zip", "zip"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/webp", "webp"],
  ["text/csv", "csv"],
  ["text/markdown", "md"],
  ["text/plain", "txt"],
]);

export function createVaultComposerAttachmentHandler(options: VaultComposerAttachmentHandlerOptions): ComposerAttachmentHandler {
  return {
    saveFiles: (files) => saveComposerAttachmentFiles(options, files),
  };
}

async function saveComposerAttachmentFiles(
  options: VaultComposerAttachmentHandlerOptions,
  files: readonly File[],
): Promise<ComposerAttachment[]> {
  if (files.length === 0) return [];

  const vault = options.app.vault;
  const destination = createObsidianVaultPathDestination(vault);
  const folder = attachmentFolderPath(options.attachmentFolder(), (path) => destination.normalizePath(path));
  await ensureVaultFolder(destination, folder);

  const attachments: ComposerAttachment[] = [];
  for (const file of files) {
    const filename = attachmentFilename(file, options.now?.() ?? new Date());
    const path = await uniqueVaultPath(destination, folder, filename);
    await vault.createBinary(path, await file.arrayBuffer());
    const kind = isImageFile(file, path) ? "image" : "file";
    attachments.push({
      kind,
      name: attachmentDisplayName(path),
      path,
      marker: kind === "image" ? `![[${path}]]` : `[[${path}]]`,
    });
  }
  return attachments;
}

function attachmentFolderPath(value: string, normalizePath: (path: string) => string): string {
  return vaultRelativeFolderPath(value, {
    normalizePath,
    emptyFallback: DEFAULT_ATTACHMENT_FOLDER,
    emptyPathMessage: "Attachment folder produced an empty path.",
    absolutePathMessage: "Attachment folder must be relative to the vault.",
    relativeSegmentMessage: "Attachment folder cannot contain relative path segments.",
  });
}

function attachmentFilename(file: File, now: Date): string {
  const originalName = file.name.trim();
  const filename = sanitizeFilename(originalName || generatedAttachmentFilename(file, now));
  return filename || generatedAttachmentFilename(file, now);
}

function generatedAttachmentFilename(file: File, now: Date): string {
  const extension = extensionForMimeType(file.type);
  return `${GENERATED_ATTACHMENT_PREFIX}-${formatTimestamp(now)}${extension ? `.${extension}` : ""}`;
}

function sanitizeFilename(value: string): string {
  const normalized = value.replace(/[\\/]+/g, "-").trim();
  const sanitized = sanitizeVaultPathSegment(normalized);
  if (sanitized && sanitized !== "." && sanitized !== "..") return sanitized;
  return "";
}

function splitFilename(filename: string): { stem: string; extension: string } {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: filename, extension: "" };
  return {
    stem: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

function isImageFile(file: File, path: string): boolean {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return true;
  const extension = pathExtension(path);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

function pathExtension(path: string): string | null {
  const filename = path.split("/").pop() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : null;
}

function extensionForMimeType(type: string): string | null {
  return MIME_EXTENSION_BY_TYPE.get(type.toLowerCase()) ?? null;
}

function attachmentDisplayName(path: string): string {
  const filename = path.split("/").pop() ?? path;
  const { stem } = splitFilename(filename);
  return stem || filename;
}

function formatTimestamp(date: Date): string {
  return [
    String(date.getFullYear()),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    "-",
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join("");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

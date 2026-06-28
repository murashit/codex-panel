import { type App, normalizePath, type Vault } from "obsidian";

import { DEFAULT_ATTACHMENT_FOLDER } from "../../../settings/model";
import type { ComposerAttachment, ComposerAttachmentHandler } from "../application/composer/attachments";

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
  const folder = attachmentFolderPath(options.attachmentFolder());
  await ensureFolder(vault, folder);

  const attachments: ComposerAttachment[] = [];
  for (const file of files) {
    const filename = attachmentFilename(file, options.now?.() ?? new Date());
    const path = await uniqueAttachmentPath(vault, folder, filename);
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

function attachmentFolderPath(value: string): string {
  const raw = (value.trim() || DEFAULT_ATTACHMENT_FOLDER).replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new Error("Attachment folder must be relative to the vault.");

  const rawSegments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (rawSegments.length === 0) return DEFAULT_ATTACHMENT_FOLDER;
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Attachment folder cannot contain relative path segments.");
  }

  const segments = rawSegments.map((segment) => sanitizePathSegment(segment.trim())).filter(Boolean);
  if (segments.length === 0) return DEFAULT_ATTACHMENT_FOLDER;

  const folder = normalizePath(segments.join("/"));
  if (!folder) return DEFAULT_ATTACHMENT_FOLDER;
  if (folder.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Attachment folder cannot contain relative path segments.");
  }
  return folder;
}

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  const segments = folder.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join("/");
    if (!vault.getAbstractFileByPath(path)) await vault.createFolder(path);
  }
}

async function uniqueAttachmentPath(vault: Vault, folder: string, filename: string): Promise<string> {
  const { stem, extension } = splitFilename(filename);
  let candidate = normalizePath(`${folder}/${filename}`);
  let suffix = 1;
  while (vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(`${folder}/${stem} ${String(suffix)}${extension}`);
    suffix += 1;
  }
  return candidate;
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
  const sanitized = sanitizePathSegment(normalized);
  if (sanitized && sanitized !== "." && sanitized !== "..") return sanitized;
  return "";
}

function sanitizePathSegment(value: string): string {
  return value
    .split("")
    .map((char) => (isUnsafePathChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 120)
    .trim();
}

function isUnsafePathChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*[]#^'.includes(char);
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

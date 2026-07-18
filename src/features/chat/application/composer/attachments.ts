import {
  type CodexInput,
  type CodexInputItem,
  codexTextInputWithAttachments,
  type VaultFileReference,
} from "../../../../domain/chat/input";

type ComposerAttachmentKind = "image" | "file";

export interface ComposerAttachment {
  readonly kind: ComposerAttachmentKind;
  readonly name: string;
  readonly path: string;
  readonly marker: string;
}

export interface ComposerAttachmentHandler {
  saveFiles(files: readonly File[]): Promise<readonly ComposerAttachment[]>;
}

export function codexInputWithComposerAttachments(text: string, input: CodexInput, attachments: readonly ComposerAttachment[]): CodexInput {
  const activeAttachments = attachments.filter((attachment) => text.includes(attachment.marker));
  if (activeAttachments.length === 0) return input;

  return codexTextInputWithAttachments(text, [...input, ...inputItemsForAttachments(input, activeAttachments)]);
}

function inputItemsForAttachments(input: readonly CodexInputItem[], attachments: readonly ComposerAttachment[]): CodexInputItem[] {
  const seenFileReferencePaths = new Set(input.flatMap((item) => (item.type === "fileReference" ? [item.path] : [])));
  const seenLocalImagePaths = new Set(input.flatMap((item) => (item.type === "localImage" ? [item.path] : [])));
  const items: CodexInputItem[] = [];

  for (const attachment of attachments) {
    if (!seenFileReferencePaths.has(attachment.path)) {
      seenFileReferencePaths.add(attachment.path);
      items.push(fileReferenceInputItem(attachment));
    }
    if (attachment.kind === "image" && !seenLocalImagePaths.has(attachment.path)) {
      seenLocalImagePaths.add(attachment.path);
      items.push({ type: "localImage", path: attachment.path });
    }
  }
  return items;
}

function fileReferenceInputItem(attachment: ComposerAttachment): VaultFileReference & { type: "fileReference" } {
  return {
    type: "fileReference",
    name: attachment.name,
    path: attachment.path,
  };
}

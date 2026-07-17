export interface AttachmentInsertionAnchor {
  readonly panelTargetRevision: number;
  readonly threadId: string | null;
  readonly draft: string;
  readonly start: number;
  readonly end: number;
}

export function attachmentInsertionAnchorMatches(
  anchor: AttachmentInsertionAnchor,
  target:
    | AttachmentInsertionAnchor
    | {
        panelTargetRevision: number;
        threadId: string | null;
        draft: string;
        selection: { start: number; end: number } | null;
      },
): boolean {
  if (anchor.panelTargetRevision !== target.panelTargetRevision || anchor.threadId !== target.threadId || anchor.draft !== target.draft) {
    return false;
  }
  if (!("selection" in target)) return anchor.start === target.start && anchor.end === target.end;
  return target.selection === null || (anchor.start === target.selection.start && anchor.end === target.selection.end);
}

export function attachmentInsertionAnchorAfterInsertion(
  anchor: AttachmentInsertionAnchor,
  insertion: { value: string; cursor: number },
): AttachmentInsertionAnchor {
  return { ...anchor, draft: insertion.value, start: insertion.cursor, end: insertion.cursor };
}

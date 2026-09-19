import { syncTextareaHeight } from "../../../../shared/ui/textarea-autogrow.measure";
export function syncComposerHeight(composer: HTMLTextAreaElement | null): boolean {
  const previousHeight = composer?.style.height ?? "";
  const previousOverflowY = composer?.style.overflowY ?? "";
  syncTextareaHeight(composer, {
    minHeightFallback: 56,
    maxHeightFallback: composer ? Math.min(208, composer.win.innerHeight * 0.4) : 208,
  });
  return Boolean(composer && (composer.style.height !== previousHeight || composer.style.overflowY !== previousOverflowY));
}

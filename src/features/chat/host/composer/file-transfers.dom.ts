export function composerFilesFromTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const transfer = dataTransfer as Partial<DataTransfer>;
  const files = Array.from(transfer.files ?? []).filter((file) => file.size > 0);
  if (files.length > 0) return files;

  return Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .flatMap((item) => {
      const file = item.getAsFile();
      return file && file.size > 0 ? [file] : [];
    });
}

export function composerTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const transfer = dataTransfer as Partial<DataTransfer>;
  if (Array.from(transfer.types ?? []).includes("Files")) return true;
  if (Array.from(transfer.items ?? []).some((item) => item.kind === "file")) return true;
  return Array.from(transfer.files ?? []).some((file) => file.size > 0);
}

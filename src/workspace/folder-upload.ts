/** Capture entries synchronously: DataTransfer becomes protected after drop. */
export function captureUpload(transfer: DataTransfer) {
  // Non-file items return null; snapshot handles before lazy traversal starts.
  const entries = Array.from(transfer.items, (item) =>
    item.webkitGetAsEntry(),
  ).filter((entry): entry is FileSystemEntry => !!entry);
  const fallback = [...transfer.files];
  return () =>
    import('./folder-upload-reader').then((module) =>
      module.readUpload(entries, fallback),
    );
}

/** Folder exports commonly contain metadata that is not playable media. */
export function uploadSkipReason(file: Pick<File, 'name'>) {
  if (file.name === '.DS_Store' || file.name.startsWith('._'))
    return 'macOS metadata';
  if (file.name.toLowerCase().endsWith('.aae'))
    return 'Apple Photos edit metadata';
  return undefined;
}

/** Capture entries synchronously: DataTransfer becomes protected after drop. */
export function captureUpload(transfer: DataTransfer) {
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => !!entry);
  const fallback = Array.from(transfer.files);
  return async () => {
    const { readUpload } = await import('./folder-upload-reader');
    return readUpload(entries, fallback);
  };
}

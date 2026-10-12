/** Walk captured entries lazily; drain every directory reader batch. */
export async function readUpload(entries: FileSystemEntry[], fallback: File[]) {
  const files: File[] = [],
    directories: string[] = [];
  const visit = async (entry: FileSystemEntry, prefix: string) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory) {
      directories.push(path);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const children = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject),
        );
        if (!children.length) break;
        for (const child of children) await visit(child, `${path}/`);
      }
    } else {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      Object.defineProperty(file, 'webkitRelativePath', {
        value: prefix ? path : '',
      });
      files.push(file);
    }
  };
  if (!entries.length) return { files: fallback, directories };
  for (const entry of entries) await visit(entry, '');
  return { files, directories };
}

/** Folder exports commonly contain metadata that is not playable media. */
export function uploadSkipReason(file: Pick<File, 'name'>) {
  if (file.name === '.DS_Store' || file.name.startsWith('._'))
    return 'macOS metadata';
  if (file.name.toLowerCase().endsWith('.aae'))
    return 'Apple Photos edit metadata';
  return undefined;
}

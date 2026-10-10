/** UI actions open the existing workflow or call its canonical owner. */
export interface WorkspaceCommand {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

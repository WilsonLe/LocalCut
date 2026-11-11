# Storyboard workflows

Use the Storyboard project tab for a local whiteboard alongside the timeline. The canvas stays local, shares project history and persists through reload and backups. Product agent tooling is removed; all operations use the [editor facade](api.md#storyboard-commands).

## Insert pictures

Draw or edit shapes/text in the canvas, then use the existing shared history controls to undo or redo. Image elements reference local Media assets by stable IDs; missing originals require relinking. Native canvas files and object URLs are runtime-only data.

For export, choose PNG, SVG or editable scene output through the storyboard controls. Capture the selected frame/elements or the full drawing. PNG can be stored in Media through the existing immutable import/library owner, then placed on the timeline through normal editing. Exported files remain user-owned. See [export and Media reuse](api.md#storyboard-export-and-media-reuse) and [storage](storage.md#project-storyboard).

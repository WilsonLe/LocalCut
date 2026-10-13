# Storyboard authoring, export and reuse

Storyboard is the project's local Excalidraw whiteboard for drawings, text and images. Open the **Storyboard** tab or ask Klip to build or revise a diagram. The [API contract](api.md#storyboard-export-and-media-reuse) defines shared export/storage options; [AI contracts](ai.md#workspace-requested-execution) define requested workspace execution and headless review.

## Build a timeline from a shot plan

Ask Klip to build the timeline from the storyboard. It inspects the entire board, current timeline and permitted project Media, then applies missing source clips, order, timing, transitions and specified titles/audio through the shared editing commands. It chooses routine details within the brief, reports assumptions and verifies matching portions without rebuilding. A title or music note on the board is a requirement to check, not proof it already exists on the timeline.

Missing required sources need the specific Media import or sharing step after permitted library discovery. Klip continues independent supported work; it does not invent a soundtrack or add optional exports outside the request. The [completion review](ai.md#request-completion-review) verifies the requested result and preserves real blockers.

## Supported authoring workflows

| Task                                                                                    | Shared agent path                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shot panels, notes, process maps, decision trees, mind maps, wireframes and annotations | Load `storyboard`; inspect the existing scene; create rectangles, diamonds, ellipses, text, arrows, lines, frames or freehand elements with stable IDs.                                  |
| Consistent appearance and readable labels                                               | Patch color, fills, strokes, roughness, opacity, roundness, font size/alignment and label bounds; preserve unrelated fields.                                                             |
| Align, distribute, grid, move, resize and rotate                                        | Calculate from inspected geometry and apply partial patches to every affected member. A frame move does not automatically move its children.                                             |
| Group, ungroup, organize sections and duplicate                                         | Patch group/frame membership; duplicate using new element/group IDs and remap internal text/arrow/frame references. Existing withheld text cannot be faithfully duplicated until shared. |
| Bind labels and connections                                                             | Keep reciprocal container/label bindings; route local line/arrow points and arrowheads.                                                                                                  |
| Change layer order or canvas background                                                 | `reorderStoryboardElements` lists every live ID once, back to front; `setStoryboardBackground` changes only the color. Neither requires reading labels.                                  |
| Delete, clear or recover                                                                | Element removal cleans dangling references. Full scene replacement requires an explicit replacement request. Diagram and timeline share project Undo/Redo.                               |

The runtime storyboard skill includes detailed recipes and canonical schema discovery. Klip loads only domains needed for the current request. [The contributor AI guide](../src/ai/AGENTS.md) explains how those prompts and discovery rules are maintained.

## Insert pictures

Choose **Upload image** or **Insert image from Media** in the Storyboard menu. Media accepts ready images and videos; select the source-relative video time for a still. Each insertion saves a PNG snapshot in Media and places it on the board. Moving, cropping, flipping, resizing, grouping and layering use ordinary Excalidraw controls. Undo removes the placement while retaining its Media asset.

Klip loads `storyboard` and calls `propose_action` with `insert_storyboard_image` and `options: { assetId, elementId, timeUs?, x?, y?, width?, height?, frameId? }`. Resolve nested project Media with the editing skill or attach the source. Use saved index evidence to choose representative frames; uncertain coverage stays unknown. The receipt returns the new local image asset ID and authored revision. The agent receives IDs and geometry, never pixels. All three export formats include the actual pictures, and original-inclusive backups retain them.

## Export formats

The canvas menu offers **Export PNG**, **Export SVG**, **Export editable scene**, and **Store PNG in Media**. Toggle entire board/selected elements, background/transparency and output scale before exporting. The UI flushes unfinished drawing writes before taking a saved revision. Klip can additionally set padding, a plain filename and a project Media folder ID.

See the production Chrome [desktop export menu](images/storyboard-export-menu.png) and [mobile export menu](images/storyboard-export-mobile.png).

| Format        | Use                                                               | Ownership                                                                                                                                 |
| ------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PNG           | Timeline stills, transparent overlays, slides and document images | Local raster snapshot. Store in Media for immutable asset reuse; download for external use.                                               |
| SVG           | Scalable diagrams for compatible document/design tools            | Local vector snapshot with drawing fonts embedded; no editable-scene metadata.                                                            |
| `.excalidraw` | Continue editing in an external Excalidraw installation           | Local scene JSON with shapes, labels and canvas color. LocalCut does not currently import this format through a dedicated scene importer. |

Exports can cover the whole board or selected IDs. Selected frames include descendants, groups include members, and shapes include bound labels. Arrow bindings to excluded shapes are detached. Choose a frame for a shot-sized image or group for an overlay. Selected contents determine the image bounds, including export padding; frame selection does not impose an arbitrary video output resolution. Empty images fail; an empty editable scene can be exported. Oversized PNG requests explain how to reduce scale/select a region or use SVG.

Local exports include authored text even if text sharing with a chat provider is disabled. The agent receives artifact metadata rather than file bytes. A requested agent export creates a local artifact with a **Save** action; the user downloads it separately. No cloud account, publishing or provider upload is involved. Images remain local; web embeds and live collaboration are unavailable.

## Diagram to reusable Media and timeline

Example request: “Make a transparent flow diagram, store it in Media under Diagrams, and overlay it for five seconds.”

1. Klip loads `storyboard`, inspects the board and creates or patches the diagram through validated commands.
2. It loads `editing`, inspects the project library and creates/reuses a destination folder. Folder IDs and asset IDs are different.
3. It calls `store_storyboard` with PNG, transparent background and the folder ID. The returned receipt contains `assetId`, `entryId`, library revision and captured project revision.
4. It inspects the generated asset and inserts an image clip on an appropriate track with the requested duration and project-fit dimensions. Editing can then animate that individual placement, crop it, blend it or apply a mask.
5. It inspects the timeline to verify placement and timing. Loading the video `export` skill is necessary only if MP4/WebM output is requested.

The stored PNG survives refresh and remains unchanged when the board changes. A new Store action creates a fresh asset; identical scene/options reuse rendered bytes. Store alone does not insert a clip, change timeline history or download a file. Undoing the diagram/timeline does not remove the stored Media asset. Use library Trash/Restore for organization; editing originals remain retained. A generated asset is authorized in the current assistant session; a future session must select it or reference it on the timeline.

## Evidence to storyboard to animatic

Example request: “Use the indexed trip scenes and shared speech timestamps to build a shot plan, then turn the panels into an animatic.”

1. Load `editing` to inspect selected assets and project dimensions. Load `indexing` to read saved scene evidence or explicitly request new analysis. Do not infer unseen footage from a filename or sampled observation.
2. Load `transcription` to read authorized source-relative phrases or explicitly transcribe through a supported route. Retain the distinction between authored scripts and measured speech.
3. Load `storyboard` and make one frame per planned shot with authorized source IDs/timestamps, visual hierarchy, camera/action notes and flow arrows. Mark creative decisions as proposals rather than observed facts.
4. Store each shot frame as a PNG, then use `editing` to place returned assets in sequence and combine them with existing audio/video or measured speech. Timeline times are integer microseconds.
5. Verify positions with `inspect_timeline`; load `export`, run the exact codec probe and encode MP4/WebM if requested. Whiteboard PNG/SVG export does not encode video.

New indexing/transcription may use configured services under their existing authorization and retry contracts. Whiteboard rendering itself stays local. Missing evidence or a host executor blocks only the step that needs it; continue supported work without inventing tools.

## Documents, interchange and recovery

For a report or presentation, export SVG or PNG and attach it through a declared document tool in the consuming host, or download it for manual attachment. LocalCut's editing agent does not have an arbitrary document-writing tool. For external diagram editing, download `.excalidraw`. For a complete LocalCut project, use the existing project/workspace transfer and include originals for selected stored assets; unreferenced library assets require explicit transfer selection. [Backups](storage.md#workspace-and-project-transfer) have their own scope and limits.

Stale revision or invalid selection/folder errors require fresh inspection and a corrected request. Rendering is revision-bound and cache-safe. Cancelling before original publication creates no new Media asset; a committed import remains retained after late cancellation. A folder change or storage failure can prevent named library placement after original import; the operation reports failure and retains the original rather than automatically duplicating it. Historical project views remain read-only. No provider/model call is authorized by opening a board, restoring a cached file or loading a skill.

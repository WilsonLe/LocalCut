import { useState } from 'react';
import type { RefObject } from 'react';
import type { Asset, Clip, EditOperation, Editor, Project } from '../editor';
import type { TextStyleInput } from '../core/text-library';
import { transitionPairs } from '../core/timeline';
import type { TransitionTemplate } from '../core/timeline';
import {
  copySelection,
  pasteSelection,
  trimAtPlayhead,
  rippleDeleteSelection,
} from './editing-actions';
import type { ClipClipboard } from './editing-actions';
import type { PlaybackPosition } from './playback-position';

interface TimelineEditingOptions {
  project: Project | null;
  viewProject: Project | null;
  selectedClip: Clip | undefined;
  selected: string | undefined;
  selectedIds: string[];
  assets: Asset[];
  busy: boolean;
  browsed: boolean;
  browsing: RefObject<boolean>;
  selectionLocked: boolean;
  playheadInsideSelection: boolean;
  playbackPosition: PlaybackPosition;
  action(work: () => Promise<void>): Promise<boolean>;
  apply(
    operations: EditOperation[],
    scope?: { projectId: string; revision: number },
  ): Promise<void>;
  ensureEditor(): Promise<Editor>;
  refresh(): Promise<void>;
  setDialog(dialog: 'properties'): void;
  setSelected(id: string | undefined): void;
  setSelection(ids: string[]): void;
}

/** Bind timeline gestures to the shell's revision-aware command and error owner.
 * This hook owns only the in-session clipboard, never a second project document. */
export function useTimelineEditing({
  project,
  viewProject,
  selectedClip,
  selected,
  selectedIds,
  assets,
  busy,
  browsed,
  browsing,
  selectionLocked,
  playheadInsideSelection,
  playbackPosition,
  action,
  apply,
  ensureEditor,
  refresh,
  setDialog,
  setSelected,
  setSelection,
}: TimelineEditingOptions) {
  const [clipboard, setClipboard] = useState<ClipClipboard | null>(null);
  const undo = () => {
    if (browsing.current || !project) return;
    void action(async () => {
      const engine = await ensureEditor();
      await engine.commands.undo(
        project!.id,
        crypto.randomUUID(),
        project!.revision,
      );
      await refresh();
    });
  };
  const redo = () => {
    if (browsing.current || !project) return;
    void action(async () => {
      const engine = await ensureEditor();
      await engine.commands.redo(
        project!.id,
        crypto.randomUUID(),
        project!.revision,
      );
      await refresh();
    });
  };
  const split = () => {
    if (!project || !selectedClip) return;
    void action(async () => {
      await apply([
        {
          type: 'splitClip',
          clipId: selected!,
          atUs: Math.round(playbackPosition.getSnapshot()),
          rightClipId: crypto.randomUUID(),
        },
      ]);
    });
  };
  const deleteClip = () => {
    if (!project || !selectedClip) return;
    void action(async () => {
      await apply(
        selectedIds.map((clipId) => ({ type: 'removeClip', clipId })),
      );
      setSelection([]);
    });
  };
  const addTrack = (kind: 'video' | 'audio') => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply([
        { type: 'addTrack', track: { id: crypto.randomUUID(), kind } },
      ]);
    });
  };
  const reorderTrack = (trackId: string, index: number) => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply([{ type: 'reorderTrack', trackId, index }]);
    });
  };
  const trackOperation = (
    operations: EditOperation[],
    scope: { projectId: string; revision: number },
  ) => {
    if (!project || busy || browsing.current) return;
    void action(async () => {
      await apply(operations, scope);
    });
  };
  const insertText = (style: TextStyleInput) => {
    if (!project || browsed) return;
    void action(async () => {
      const track = project!.tracks.find(
        (track) => track.kind === 'overlay' && !track.locked,
      );
      const trackId = track?.id ?? crypto.randomUUID();
      const id = crypto.randomUUID();
      await apply([
        ...(!track
          ? [
              {
                type: 'addTrack' as const,
                track: { id: trackId, kind: 'overlay' as const },
              },
            ]
          : []),
        {
          type: 'insertClip',
          trackId,
          clip: {
            id,
            kind: 'text',
            startUs: Math.round(playbackPosition.getSnapshot()),
            durationUs: 3_000_000,
            width: project!.width,
            height: project!.height * 0.5,
            y: project!.height * 0.3,
            text: {
              ...style,
              fontSize: ((style.fontSize ?? 64) * project!.width) / 1920,
              ...(style.letterSpacing !== undefined
                ? {
                    letterSpacing:
                      (style.letterSpacing * project!.width) / 1920,
                  }
                : {}),
              ...(style.outlineWidth !== undefined
                ? { outlineWidth: (style.outlineWidth * project!.width) / 1920 }
                : {}),
              ...(style.shadow
                ? {
                    shadow: {
                      color: style.shadow.color,
                      blur: (style.shadow.blur * project!.width) / 1920,
                      offsetX: (style.shadow.offsetX * project!.width) / 1920,
                      offsetY: (style.shadow.offsetY * project!.width) / 1920,
                    },
                  }
                : {}),
            },
          },
        },
      ]);
      setSelected(id);
      setSelection([]);
      setDialog('properties');
    });
  };
  const duplicate = () => {
    if (!project || !selectedClip) return;
    const clips = project.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => selectedIds.includes(clip.id));
    const deltaUs =
      Math.max(...clips.map((clip) => clip.startUs + clip.durationUs)) -
      Math.min(...clips.map((clip) => clip.startUs));
    const newClipIds = Object.fromEntries(
      clips.map((clip) => [clip.id, crypto.randomUUID()]),
    );
    const operations: EditOperation[] = [];
    const groups = new Set<string>();
    for (const clip of clips) {
      if (clip.groupId) {
        if (!groups.has(clip.groupId)) {
          groups.add(clip.groupId);
          const members = clips.filter((c) => c.groupId === clip.groupId);
          operations.push({
            type: 'duplicateGroup',
            groupId: clip.groupId,
            newGroupId: crypto.randomUUID(),
            newClipIds: Object.fromEntries(
              members.map((c) => [c.id, newClipIds[c.id]!]),
            ),
            deltaUs,
          });
        }
      } else {
        const track = project.tracks.find((track) =>
          track.clips.some((c) => c.id === clip.id),
        )!;
        operations.push({
          type: 'duplicateClip',
          clipId: clip.id,
          newClipId: newClipIds[clip.id]!,
          trackId: track.id,
          startUs: clip.startUs + deltaUs,
        });
      }
    }
    void action(async () => {
      await apply(operations);
      setSelected(newClipIds[selectedClip.id]);
      setSelection(Object.values(newClipIds));
    });
  };
  const selectedGroups = [
    ...new Set(
      viewProject?.tracks.flatMap((t) =>
        t.clips
          .filter((c) => selectedIds.includes(c.id))
          .flatMap((c) => (c.groupId ? [c.groupId] : [])),
      ) ?? [],
    ),
  ];
  const canGroup =
    !selectionLocked &&
    selectedIds.length >= 2 &&
    !(
      selectedGroups.length === 1 &&
      viewProject?.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.groupId === selectedGroups[0]).length ===
        selectedIds.length
    );
  const group = () =>
    void action(async () => {
      await apply([
        {
          type: 'groupClips',
          groupId: crypto.randomUUID(),
          clipIds: selectedIds,
        },
      ]);
    });
  const ungroup = () =>
    void action(async () => {
      await apply(
        selectedGroups.map((groupId) => ({ type: 'ungroupClips', groupId })),
      );
    });
  const canSeparate =
    !selectionLocked &&
    selectedIds.length === 1 &&
    selectedClip?.kind === 'video' &&
    !selectedClip.muted &&
    !!assets.find((asset) => asset.id === selectedClip.assetId)?.audioCodec;
  const separateAudio = () =>
    void action(async () => {
      if (!project || !selectedClip) return;
      const track = project.tracks.find(
        (track) => track.kind === 'audio' && !track.muted && !track.locked,
      );
      const trackId = track?.id ?? crypto.randomUUID();
      const audioClipId = crypto.randomUUID();
      await apply([
        ...(!track
          ? [
              {
                type: 'addTrack' as const,
                track: { id: trackId, kind: 'audio' as const },
              },
            ]
          : []),
        {
          type: 'separateAudio',
          clipId: selectedClip.id,
          audioClipId,
          trackId,
        },
      ]);
      setSelected(audioClipId);
      setSelection([]);
    });
  const pairs = viewProject ? transitionPairs(viewProject) : [];
  const selectedPairs = pairs.filter(
    (pair) =>
      selectedIds.includes(pair.fromClipId) &&
      selectedIds.includes(pair.toClipId),
  );
  const overlap =
    selectedPairs.length === 1
      ? selectedPairs[0]
      : selectedIds.length === 1
        ? pairs.find(
            (pair) =>
              pair.fromClipId === selected || pair.toClipId === selected,
          )
        : undefined;
  const activeTransition = viewProject?.transitions.find(
    (t) =>
      t.fromClipId === overlap?.fromClipId &&
      t.toClipId === overlap?.toClipId &&
      t.trackId === overlap?.trackId,
  );
  const setTransition = (template?: TransitionTemplate) =>
    void action(async () => {
      if (!overlap) return;
      await apply(
        template
          ? [
              {
                type: 'applyTransitionTemplate',
                transitionId: activeTransition?.id ?? crypto.randomUUID(),
                trackId: overlap.trackId,
                fromClipId: overlap.fromClipId,
                toClipId: overlap.toClipId,
                template,
              },
            ]
          : [{ type: 'removeTransition', transitionId: activeTransition!.id }],
      );
    });
  const canSplit =
    !selectionLocked &&
    selectedIds.length === 1 &&
    !!selectedClip &&
    playheadInsideSelection;
  const clearSelection = () => {
    setSelected(undefined);
    setSelection([]);
  };
  const selectAll = () => {
    const ids =
      viewProject?.tracks.flatMap((t) => t.clips.map((c) => c.id)) ?? [];
    setSelected(ids[0]);
    setSelection(ids);
  };
  const copy = () => {
    if (viewProject) setClipboard(copySelection(viewProject, selectedIds));
  };
  const cut = () => {
    if (!project) return;
    const saved = copySelection(project, selectedIds);
    void action(async () => {
      await apply(
        selectedIds.map((clipId) => ({ type: 'removeClip', clipId })),
      );
      setClipboard(saved);
      clearSelection();
    });
  };
  const paste = () =>
    void action(async () => {
      if (!project || !clipboard) return;
      const { operations, ids } = pasteSelection(
        project,
        clipboard,
        playbackPosition.getSnapshot(),
      );
      if (!operations.length) return;
      await apply(operations);
      setSelected(ids[0]);
      setSelection(ids);
    });
  const editSelection = (operations: EditOperation[], clear = false) =>
    void action(async () => {
      if (!operations.length) return;
      await apply(operations);
      if (clear) clearSelection();
    });
  const trimStartOperations =
    canSplit && selectedClip
      ? trimAtPlayhead(selectedClip, playbackPosition.getSnapshot(), 'start')
      : [];
  const trimEndOperations =
    canSplit && selectedClip
      ? trimAtPlayhead(selectedClip, playbackPosition.getSnapshot(), 'end')
      : [];
  const rippleOperations = project
    ? rippleDeleteSelection(project, selectedIds)
    : [];
  return {
    undo,
    redo,
    split,
    deleteClip,
    addTrack,
    reorderTrack,
    trackOperation,
    insertText,
    duplicate,
    canGroup,
    group,
    ungroup,
    canSeparate,
    separateAudio,
    overlap,
    activeTransition,
    setTransition,
    canSplit,
    clearSelection,
    selectAll,
    copy,
    cut,
    paste,
    editSelection,
    trimStartOperations,
    trimEndOperations,
    rippleOperations,
    clipboard,
    selectedGroups,
  };
}

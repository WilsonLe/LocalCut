import type { StoryboardImageOptions } from '../core/storyboard-image';
import type { LibraryOperation } from '../core/media-library';
import type { EditReceipt } from '../core/commands';
import type { Editor } from '../editor';
import type { CodingOperation } from '../core/coding';
import type { CodingResult } from '../services/coding';
import type { ExportOptions } from '../media/export';
import type {
  StoryboardExportOptions,
  StoryboardStoreOptions,
} from '../core/storyboard-export';

/** Service actions are reviewable requests, never callable by a model directly. */
export type AssistantAction =
  | { type: 'coding'; operation: CodingOperation; expectedRevision: number }
  | { type: 'undo' | 'redo' }
  | { type: 'library'; operation: LibraryOperation; expectedRevision: number }
  | { type: 'export'; options: ExportOptions }
  | { type: 'export_storyboard'; options: StoryboardExportOptions }
  | { type: 'store_storyboard'; options: StoryboardStoreOptions }
  | { type: 'insert_storyboard_image'; options: StoryboardImageOptions }
  | {
      type: 'transcribe';
      assetId: string;
      options?: { language?: string; startUs?: number; endUs?: number };
    }
  | { type: 'index_asset'; assetId: string; restart?: boolean }
  | { type: 'prepare_transcription' }
  | { type: 'track_mask'; clipId: string };

export type AssistantActionResult =
  | { kind: 'coding'; workspace: CodingResult }
  | {
      kind: 'coding_asset';
      projectId: string;
      assetId: string;
      libraryRevision: number;
    }
  | { kind: 'edit' | 'history'; receipt: EditReceipt }
  | {
      kind: 'storyboard_image';
      projectId: string;
      revision: number;
      assetId: string;
      elementId: string;
      receipt: EditReceipt;
    }
  | {
      kind: 'export';
      artifactId: string;
      projectId: string;
      revision: number;
      format: 'mp4' | 'webm';
      name: string;
      size: number;
      durationUs: number;
    }
  | {
      kind: 'transcription';
      transcriptId: string;
      assetId: string;
      cueCount: number;
    }
  | { kind: 'indexing'; runId: string; assetId: string; sceneCount: number }
  | { kind: 'preparation'; ready: boolean }
  | { kind: 'library'; revision: number }
  | {
      kind: 'storyboard_export';
      artifactId: string;
      projectId: string;
      revision: number;
      format: 'png' | 'svg' | 'excalidraw';
      name: string;
      size: number;
    }
  | {
      kind: 'storyboard_asset';
      projectId: string;
      revision: number;
      assetId: string;
      entryId: string;
      libraryRevision: number;
    };

/** An assistant may be embedded with just document editing, or the full engine. */
export interface AssistantEditor {
  coding?: Pick<Editor['coding'], 'inspect' | 'query' | 'run' | 'importFile'>;
  storyboard?: Partial<
    Pick<Editor['storyboard'], 'export' | 'store' | 'insertImage'>
  >;
  library?: {
    forProject(
      projectId: string,
    ): Pick<ReturnType<Editor['library']['forProject']>, 'list' | 'apply'>;
  };
  tasks?: Editor['tasks'];
  masks?: Editor['masks'];
  projects: Pick<Editor['projects'], 'snapshot'>;
  assets: Pick<Editor['assets'], 'inspect'> & {
    indexes?: Pick<Editor['assets']['indexes'], 'list'>;
  };
  transcription: Pick<Editor['transcription'], 'transcript'> &
    Partial<Pick<Editor['transcription'], 'status' | 'prepare' | 'transcribe'>>;
  commands: Pick<Editor['commands'], 'validate' | 'apply'> &
    Partial<Pick<Editor['commands'], 'undo' | 'redo'>>;
  exports?: Pick<Editor['exports'], 'preflight' | 'start'>;
}

export interface AssistantCapabilities {
  coding?: boolean;
  storyboardExport?: boolean;
  storyboardStore?: boolean;
  storyboardInsertImage?: boolean;
  /** Host support is discoverable even while permission blocks proposals. */
  indexingSupported?: boolean;
  indexing?: boolean;
  maskTracking?: boolean;
  library?: boolean;
  undo: boolean;
  redo: boolean;
  export: boolean;
  transcriptionStatus: boolean;
  transcription: boolean;
  transcriptionPreparation: boolean;
}

export function assistantCapabilities(
  editor: AssistantEditor,
): AssistantCapabilities {
  return {
    coding: !!editor.coding,
    storyboardExport: !!editor.storyboard?.export,
    storyboardStore: !!editor.storyboard?.store,
    storyboardInsertImage: !!editor.storyboard?.insertImage,
    maskTracking: !!editor.masks,
    library: !!editor.library,
    undo: !!editor.commands.undo,
    redo: !!editor.commands.redo,
    export: !!editor.exports,
    transcriptionStatus: !!editor.transcription.status,
    transcription: !!editor.transcription.transcribe,
    transcriptionPreparation: !!editor.transcription.prepare,
  };
}

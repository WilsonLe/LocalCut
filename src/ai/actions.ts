import type { EditReceipt } from '../core/commands';
import type { Editor } from '../editor';
import type { ExportOptions } from '../media/export';

/** Service actions are reviewable requests, never callable by a model directly. */
export type AssistantAction =
  | { type: 'undo' | 'redo' }
  | { type: 'export'; options: ExportOptions }
  | {
      type: 'transcribe';
      assetId: string;
      options?: { language?: string; startUs?: number; endUs?: number };
    }
  | { type: 'prepare_transcription' };

export type AssistantActionResult =
  | { kind: 'edit' | 'history'; receipt: EditReceipt }
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
  | { kind: 'preparation'; ready: boolean };

/** An assistant may be embedded with just document editing, or the full engine. */
export interface AssistantEditor {
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
    undo: !!editor.commands.undo,
    redo: !!editor.commands.redo,
    export: !!editor.exports,
    transcriptionStatus: !!editor.transcription.status,
    transcription: !!editor.transcription.transcribe,
    transcriptionPreparation: !!editor.transcription.prepare,
  };
}

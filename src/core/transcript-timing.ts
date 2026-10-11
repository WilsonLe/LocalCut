import { invariant } from './errors';
import type { SpeechTranscript } from './model';

/** Retain measured phrase boundaries when a take is stretched locally. */
export function retimeSpeechTranscript(
  transcript: SpeechTranscript,
  originalDurationUs: number,
  renderedDurationUs: number,
): SpeechTranscript {
  invariant(
    Number.isSafeInteger(originalDurationUs) &&
      originalDurationUs > 0 &&
      Number.isSafeInteger(renderedDurationUs) &&
      renderedDurationUs > 0,
    'INVALID_DOCUMENT',
    'Invalid speech duration',
  );
  let previous = -1;
  const ids = new Set<string>();
  const cues = transcript.cues.flatMap((cue) => {
    invariant(
      !ids.has(cue.id) &&
        Number.isSafeInteger(cue.timeUs) &&
        Number.isSafeInteger(cue.endUs) &&
        cue.timeUs >= 0 &&
        cue.timeUs >= previous &&
        cue.endUs > cue.timeUs &&
        cue.endUs <= originalDurationUs,
      'INVALID_DOCUMENT',
      'Invalid measured speech timing',
    );
    previous = cue.timeUs;
    ids.add(cue.id);
    const timeUs = Math.round(
      (cue.timeUs / originalDurationUs) * renderedDurationUs,
    );
    const endUs = Math.min(
      renderedDurationUs,
      Math.round((cue.endUs / originalDurationUs) * renderedDurationUs),
    );
    return endUs > timeUs ? [{ ...cue, timeUs, endUs }] : [];
  });
  return { ...transcript, cues };
}

/** Editing handles expand into silence only; neighboring handles never overlap. */
export function padSpeechTranscript(
  transcript: SpeechTranscript,
  durationUs: number,
  paddingUs = 80_000,
): SpeechTranscript {
  invariant(
    Number.isSafeInteger(paddingUs) && paddingUs >= 0 && paddingUs <= 1_000_000,
    'INVALID_DOCUMENT',
    'Invalid speech padding',
  );
  const measured = retimeSpeechTranscript(transcript, durationUs, durationUs);
  let previousEndUs = 0;
  const cues = measured.cues.flatMap((cue, index, all) => {
    const previous = all[index - 1],
      next = all[index + 1];
    const left = previous ? Math.round((previous.endUs + cue.timeUs) / 2) : 0;
    const right = next ? Math.round((cue.endUs + next.timeUs) / 2) : durationUs;
    const timeUs = Math.max(previousEndUs, left, cue.timeUs - paddingUs);
    const endUs = Math.min(durationUs, right, cue.endUs + paddingUs);
    if (endUs <= timeUs) return [];
    previousEndUs = endUs;
    return [{ ...cue, timeUs, endUs }];
  });
  return { ...measured, cues };
}

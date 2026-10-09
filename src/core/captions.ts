import type { Cue } from './model';
import { invariant } from './errors';
const stamp = (us: number, separator: string) => {
  const ms = Math.round(us / 1000),
    h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
};
function parseStamp(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  invariant(m, 'INVALID_DOCUMENT', 'Invalid subtitle timestamp');
  const minutes = Number(m[2]),
    seconds = Number(m[3]);
  invariant(
    minutes < 60 && seconds < 60,
    'INVALID_DOCUMENT',
    'Invalid subtitle time',
  );
  return (
    ((Number(m[1] ?? 0) * 3600 + minutes * 60 + seconds) * 1000 +
      Number(m[4])) *
    1000
  );
}
export function importCaptions(text: string): Cue[] {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  const blocks = normalized
    .replace(/^WEBVTT[^\n]*\n/, '')
    .trim()
    .split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^(NOTE|STYLE|REGION)( |$)/.test(lines[0] ?? '')) continue;
    const index = lines.findIndex((l) => l.includes('-->'));
    invariant(index >= 0, 'INVALID_DOCUMENT', 'Subtitle block has no timing');
    const [start, end] = lines[index]!.split(/\s+-->\s+/);
    const timeUs = parseStamp(start!),
      endUs = parseStamp(end!.split(/\s/)[0]!);
    invariant(
      endUs > timeUs,
      'INVALID_DOCUMENT',
      'Subtitle end must follow start',
    );
    cues.push({
      id: crypto.randomUUID(),
      timeUs,
      endUs,
      text: lines.slice(index + 1).join('\n'),
    });
  }
  return cues.sort((a, b) => a.timeUs - b.timeUs);
}
export function exportCaptions(cues: Cue[], format: 'srt' | 'vtt'): string {
  const sep = format === 'srt' ? ',' : '.';
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${stamp(c.timeUs, sep)} --> ${stamp(c.endUs, sep)}\n${c.text}`,
      )
      .join('\n\n') +
    '\n'
  );
}

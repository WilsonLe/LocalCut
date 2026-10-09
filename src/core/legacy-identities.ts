import { EditorError, invariant } from './errors';
import { nestedId, projectSchema, validateProject } from './model';
import type { Project } from './model';

/**
 * Repair only the cue identities duplicated by the original v1 duplicateClip.
 * A whole history is normalized together so reordering cannot change ownership.
 * Callers must establish that the containing record/backup is unmarked legacy.
 */
export function repairLegacyIdentities(values: unknown[]): Project[] {
  const projects = values.map((value) => {
    const parsed = projectSchema.safeParse(value);
    if (!parsed.success)
      throw new EditorError('INVALID_DOCUMENT', parsed.error.message);
    return parsed.data;
  });
  const duplicated = new Set<string>();
  const firstOwners = new Map<string, string>();
  const reserved = new Set<string>();
  for (const project of projects) {
    const other = new Set<string>();
    const add = (id: string) => {
      invariant(!other.has(id), 'INVALID_DOCUMENT', 'Duplicate object ID');
      other.add(id);
      reserved.add(id);
    };
    add(project.id);
    for (const track of project.tracks) {
      add(track.id);
      for (const clip of track.clips) {
        add(clip.id);
        for (const keys of Object.values(clip.keyframes))
          for (const key of keys) add(key.id);
      }
    }
    for (const transition of project.transitions) add(transition.id);
    const owners = new Map<string, string>();
    for (const track of project.tracks)
      for (const clip of track.clips) {
        const local = new Set<string>();
        for (const cue of clip.cues) {
          invariant(
            !other.has(cue.id) && !local.has(cue.id),
            'INVALID_DOCUMENT',
            'Legacy cue ID collides with another object or cue in its clip',
          );
          local.add(cue.id);
          reserved.add(cue.id);
          if (!firstOwners.has(cue.id)) firstOwners.set(cue.id, clip.id);
          if (owners.has(cue.id)) duplicated.add(cue.id);
          owners.set(cue.id, clip.id);
        }
      }
  }
  const replacements = new Map<string, string>();
  for (const project of projects)
    for (const track of project.tracks)
      for (const clip of track.clips)
        for (const cue of clip.cues) {
          if (!duplicated.has(cue.id) || firstOwners.get(cue.id) === clip.id)
            continue;
          const owner = JSON.stringify([clip.id, cue.id]);
          let replacement = replacements.get(owner);
          if (!replacement) {
            replacement = nestedId('cue', clip.id, `legacy:${cue.id}`);
            invariant(
              !reserved.has(replacement),
              'INVALID_DOCUMENT',
              'Legacy cue normalization would collide with an existing ID',
            );
            reserved.add(replacement);
            replacements.set(owner, replacement);
          }
          cue.id = replacement;
        }
  return projects.map(validateProject);
}

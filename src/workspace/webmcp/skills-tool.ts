import { z } from 'zod';
import { EditorError, invariant } from '../../core/errors';
import { toolErrorResult } from './error-result';
import type { SiteTool } from './types';

const name = z
  .string()
  .regex(/^localcut-[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('get'), name }).strict(),
]);
const catalogSchema = z
  .object({
    version: z.literal(1),
    skills: z
      .array(
        z
          .object({
            name,
            description: z.string().min(1).max(1024),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** Public guidance belongs to the app lifetime, never an editor/project session. */
export function skillsTool(lifetime: AbortSignal, baseUrl: string): SiteTool {
  return {
    name: 'localcut_skills',
    description:
      'Discover LocalCut workflow guidance before editing. list returns skill names/descriptions; get with a name returns the complete published SKILL.md. Start with localcut-start, then load only relevant skills for video editing, asset context/transcript notes, references, storyboards, audio, motion, typography, captions, narration, music, images or export review. Available without an open project. No plugin installation, AI account or provider required.',
    inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input, options) => {
      try {
        const signal = AbortSignal.any([lifetime, options.signal]);
        signal.throwIfAborted();
        const parsed = inputSchema.parse(input);
        const read = async (path: string) => {
          try {
            const response = await fetch(new URL(path, baseUrl), {
              signal,
              cache: 'no-cache',
            });
            invariant(response.ok, 'MISSING_ASSET', 'Skill file unavailable.');
            return response;
          } catch {
            signal.throwIfAborted();
            throw new EditorError(
              'MISSING_ASSET',
              'LocalCut skill files are unavailable. Retry when connected or reload LocalCut to reconnect to the current release.',
            );
          }
        };
        const catalog = catalogSchema.parse(
          await (await read('index.json')).json(),
        );
        signal.throwIfAborted();
        const skills = catalog.skills.map((skill) => ({
          ...skill,
          url: new URL(`${skill.name}/SKILL.md`, baseUrl).href,
          licenseUrl: new URL(`${skill.name}/LICENSE.txt`, baseUrl).href,
        }));
        if (parsed.action === 'list')
          return { version: catalog.version, skills };
        const skill = skills.find((entry) => entry.name === parsed.name);
        invariant(
          skill,
          'NOT_FOUND',
          'Unknown LocalCut skill. Call localcut_skills with action list for available names.',
        );
        const bytes = await (
          await read(`${skill.name}/SKILL.md`)
        ).arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        signal.throwIfAborted();
        const sha256 = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        invariant(
          sha256 === skill.sha256,
          'MISSING_ASSET',
          'LocalCut skill files do not match their index. Reload LocalCut and retry; do not follow the mismatched content.',
        );
        return {
          version: catalog.version,
          ...skill,
          content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        };
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  };
}

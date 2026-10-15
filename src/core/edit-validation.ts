import { EditorError } from './errors';

/** Fixed diagnostic vocabulary: never forward exception prose or authored values. */
export const editValidationRules = {
  transition_overlap: {
    message:
      'Transition requires adjacent ordered overlap of visual media clips on one video track without a third clip',
    repair:
      'Create a positive overlap between the ordered adjacent visual clips on the same video track, with no third intersecting clip; otherwise remove the transition and use a hard cut. Touching or gapped clips cannot crossfade.',
  },
  media_source_range: {
    message: 'Media source range required',
    repair: 'Set sourceOutUs greater than sourceInUs for timed media.',
  },
  source_duration: {
    message: 'Duration must match source range and speed',
    repair:
      'Keep durationUs consistent with the selected source interval and speed, or use the canonical trim/speed operation.',
  },
  fades_duration: {
    message: 'Fades exceed duration',
    repair:
      'Shorten fades to fit the clip or its fade envelope when changing duration.',
  },
  keyframe_bounds: {
    message: 'Keyframes must be ordered and within clip',
    repair:
      'Order keyframe times strictly and keep every timeUs within the new clip duration.',
  },
  source_bounds: {
    message: 'Clip exceeds source duration',
    repair:
      'Inspect source duration and select an in-bounds source interval; do not extend source media to fill the timeline.',
  },
  schema: {
    message: 'Edit fields do not match the canonical schema',
    repair:
      'Inspect the canonical operation/property schema and correct the reported field types or unsupported fields.',
  },
} as const;
export type EditValidationRule = keyof typeof editValidationRules;

export function validationInvariant(
  condition: unknown,
  rule: EditValidationRule,
  location: {
    trackIndex?: number;
    clipIndex?: number;
    transitionIndex?: number;
  } = {},
  code: 'INVALID_DOCUMENT' | 'INVALID_COMMAND' = 'INVALID_DOCUMENT',
): asserts condition {
  if (!condition)
    throw new EditorError(code, editValidationRules[rule].message, {
      validation: { rule, ...location },
    });
}

/** Reconstruct allowlisted diagnostics, including when a host supplies an error. */
export function editValidationDiagnostic(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.rule !== 'string' ||
    !Object.hasOwn(editValidationRules, input.rule)
  )
    return undefined;
  const rule = input.rule as EditValidationRule;
  const diagnostic: Record<string, string | number> = {
    rule,
    ...editValidationRules[rule],
  };
  for (const field of ['trackIndex', 'clipIndex', 'transitionIndex'] as const) {
    const index = input[field];
    if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0)
      diagnostic[field] = index;
  }
  if (
    rule === 'schema' &&
    typeof input.fieldPath === 'string' &&
    input.fieldPath
      .split('.')
      .every((part) => schemaFields.has(part) || /^(0|[1-9][0-9]*)$/.test(part))
  )
    diagnostic.fieldPath = input.fieldPath;
  return diagnostic;
}

const schemaFields = new Set([
  'operations',
  'patch',
  'clip',
  'track',
  'transition',
  'tracks',
  'clips',
  'transitions',
  'type',
  'kind',
  'id',
  'clipId',
  'trackId',
  'transitionId',
  'fromClipId',
  'toClipId',
  'assetId',
  'startUs',
  'durationUs',
  'sourceInUs',
  'sourceOutUs',
  'speed',
  'keyframes',
  'timeUs',
  'value',
  'interpolation',
  'opacity',
  'x',
  'y',
  'width',
  'height',
  'fadeInUs',
  'fadeOutUs',
  'text',
  'fontFamily',
  'fontSize',
]);
export function schemaValidation(issues: readonly { path: PropertyKey[] }[]) {
  const path = issues[0]?.path ?? [];
  return {
    rule: 'schema',
    ...(path.length &&
    path.every((part) =>
      typeof part === 'number'
        ? Number.isSafeInteger(part) && part >= 0
        : typeof part === 'string' && schemaFields.has(part),
    )
      ? { fieldPath: path.join('.') }
      : {}),
  };
}

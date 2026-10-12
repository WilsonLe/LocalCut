import { z } from 'zod';
import { applyOperations, batchSchema } from '../core/commands';
import type { CommandBatch } from '../core/commands';
import {
  assetIds,
  clipPatchSchema,
  trackPatchSchema,
  textStyleSchema,
  parameterSchema,
  keyframeSchema,
} from '../core/model';
import {
  TEXT_FONTS,
  TEXT_TEMPLATES,
  matchesTextLabels,
} from '../core/text-library';
import type { Project } from '../core/model';
import { EditorError } from '../core/errors';
import { AiError, aiInvariant } from './errors';
import type { ToolDefinition } from './types';
import type { AssistantCapabilities } from './actions';
import { skillCatalog } from './skills';
import type { SkillId } from './skills';

const emptySchema = z.object({}).strict();
const assetSchema = z.object({ assetId: z.string().min(1).max(200) }).strict();
const transcriptSchema = z
  .object({ transcriptId: z.string().min(1).max(200) })
  .strict();
const operationsSchema = z
  .object({ operations: batchSchema.shape.operations })
  .strict();
const proposalSchema = operationsSchema.extend({
  summary: z.string().min(1),
});
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const exportOptionsSchema = z
  .object({
    format: z.enum(['mp4', 'webm']),
    videoBitrate: z.number().positive().max(100_000_000).optional(),
    audioBitrate: z.number().positive().max(1_000_000).optional(),
  })
  .strict();
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('undo') }).strict(),
  z.object({ type: z.literal('redo') }).strict(),
  z
    .object({ type: z.literal('export'), options: exportOptionsSchema })
    .strict(),
  z
    .object({
      type: z.literal('transcribe'),
      assetId: z.string().min(1).max(200),
      options: z
        .object({
          language: z.string().min(1).max(100).optional(),
          startUs: time.optional(),
          endUs: time.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  assetSchema.extend({ type: z.literal('index_asset') }),
  z.object({ type: z.literal('prepare_transcription') }).strict(),
]);
const schemas = {
  load_skill: z
    .object({
      skillId: z.enum([
        'editing',
        'storyboard',
        'export',
        'transcription',
        'indexing',
        'history',
      ]),
    })
    .strict(),
  search_asset_index: z
    .object({
      query: z.string(),
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  read_asset_index: assetSchema.extend({
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  inspect_project: emptySchema,
  inspect_storyboard: z
    .object({
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(50),
    })
    .strict(),
  inspect_asset: assetSchema,
  inspect_timeline: z.object({ timeUs: time }).strict(),
  inspect_capabilities: emptySchema,
  search_text_library: z
    .object({
      kind: z.enum(['fonts', 'templates']),
      query: z.string().default(''),
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(10),
    })
    .strict(),
  inspect_transcription: emptySchema,
  inspect_proposals: emptySchema,
  read_transcript: transcriptSchema,
  validate_edits: operationsSchema,
  check_export: z.object({ options: exportOptionsSchema }).strict(),
  propose_edits: proposalSchema,
  propose_action: z
    .object({
      summary: z.string().min(1),
      action: actionSchema,
    })
    .strict(),
};
export type ToolName = keyof typeof schemas;
export const supportedEditOperations =
  batchSchema.shape.operations.element.options.map(
    (operation) => operation.shape.type.value,
  );

export const editingProperties = {
  clip: Object.keys(clipPatchSchema.shape),
  track: Object.keys(trackPatchSchema.shape),
  textStyle: Object.keys(textStyleSchema.shape),
  keyframes: {
    parameters: parameterSchema.options,
    interpolation: keyframeSchema.shape.interpolation.removeDefault().options,
    values: Object.fromEntries(
      parameterSchema.options.map((parameter) => [
        parameter,
        z.toJSONSchema(clipPatchSchema.shape[parameter], { io: 'input' }),
      ]),
    ),
  },
};

/** The workspace's catalog and matcher; no media, private text or font downloads. */
export function searchTextLibrary(
  args: z.infer<typeof schemas.search_text_library>,
) {
  const catalog = args.kind === 'fonts' ? TEXT_FONTS : TEXT_TEMPLATES;
  const matches = catalog.filter((item) => matchesTextLabels(item, args.query));
  const end = Math.min(args.offset + args.limit, matches.length);
  return {
    ...args,
    total: matches.length,
    items: structuredClone(matches.slice(args.offset, end)),
    nextOffset: end < matches.length ? end : null,
  };
}

type AccessBlocker = {
  reason:
    | 'host_unavailable'
    | 'sharing_disabled'
    | 'skill_not_loaded'
    | 'caller_budget';
  nextStep: string;
};
type AccessRule = {
  skills: readonly SkillId[];
  support?: readonly [boolean, string];
  permission?: readonly [boolean, string];
};

/** The same rules own declarations, complete discovery and rejected-call recovery. */
export function capabilityDiscovery(
  includeTranscripts: boolean,
  capabilities: AssistantCapabilities,
  loadedSkills: ReadonlySet<SkillId> = new Set(),
  includeAssetIndexes = false,
  hasAssetIndexes = true,
  budgetExhausted = false,
) {
  const access = (rule: AccessRule) => {
    const supported = rule.support?.[0] ?? true;
    const blockers: AccessBlocker[] = [];
    if (!supported)
      blockers.push({ reason: 'host_unavailable', nextStep: rule.support![1] });
    if (rule.permission && !rule.permission[0])
      blockers.push({
        reason: 'sharing_disabled',
        nextStep: rule.permission[1],
      });
    if (rule.skills.length && !rule.skills.some((id) => loadedSkills.has(id)))
      blockers.push({
        reason: 'skill_not_loaded',
        nextStep: `Call load_skill with one of: ${rule.skills.join(', ')}. Its tools become available in the next round.`,
      });
    if (budgetExhausted)
      blockers.push({
        reason: 'caller_budget',
        nextStep:
          'The explicit caller tool budget is exhausted. Summarize completed results and request a new turn for unfinished work.',
      });
    return {
      supported,
      available: !blockers.length,
      requiredSkills: rule.skills,
      blockers,
    };
  };
  const actions = {
    undo: access({
      skills: ['history'],
      support: [
        capabilities.undo,
        'This session has no Undo executor. Use the workspace history control or reconnect with history support.',
      ],
    }),
    redo: access({
      skills: ['history'],
      support: [
        capabilities.redo,
        'This session has no Redo executor. Use the workspace history control or reconnect with history support.',
      ],
    }),
    export: access({
      skills: ['export'],
      support: [
        capabilities.export,
        'This session has no export executor. Use the workspace Export control or a host with export support.',
      ],
    }),
    transcribe: access({
      skills: ['transcription'],
      support: [
        capabilities.transcription,
        'This session has no transcription executor. Use the workspace transcription control or a host with transcription support.',
      ],
    }),
    prepare_transcription: access({
      skills: ['transcription'],
      support: [
        capabilities.transcriptionPreparation,
        'This session has no model-preparation executor. Use the workspace transcription preparation control or a host with preparation support.',
      ],
    }),
    index_asset: access({
      skills: ['indexing'],
      support: [
        !!(capabilities.indexingSupported || capabilities.indexing),
        'This session has no compatible indexing executor. In the workspace, select an OpenRouter model with image or audio input.',
      ],
      permission: [
        !!capabilities.indexing,
        'Enable indexing consent and asset-index sharing. In the workspace, enable Allow asset indexing in AI connection → Data & analytics.',
      ],
    }),
  } satisfies Record<
    z.infer<typeof actionSchema>['type'],
    ReturnType<typeof access>
  >;
  const indexRead: AccessRule = {
    skills: [],
    support: [
      hasAssetIndexes,
      'This session cannot read saved indexes. Use a host with asset-index storage support.',
    ],
    permission: [
      includeAssetIndexes,
      'Enable asset-index sharing before reading saved labels. In the workspace, enable Allow asset indexing in AI connection → Data & analytics.',
    ],
  };
  const rules = {
    load_skill: { skills: [] },
    inspect_project: { skills: [] },
    inspect_capabilities: { skills: [] },
    inspect_proposals: { skills: [] },
    search_asset_index: indexRead,
    read_asset_index: indexRead,
    inspect_asset: { skills: ['editing', 'transcription', 'indexing'] },
    inspect_storyboard: { skills: ['storyboard'] },
    inspect_timeline: { skills: ['editing'] },
    search_text_library: { skills: ['editing'] },
    validate_edits: { skills: ['editing', 'storyboard'] },
    propose_edits: { skills: ['editing', 'storyboard'] },
    read_transcript: {
      skills: ['transcription'],
      permission: [
        includeTranscripts,
        'Enable transcript-text sharing in the context policy before reading existing transcripts. Local transcription approval does not enable this sharing.',
      ],
    },
    check_export: {
      skills: ['export'],
      support: [
        capabilities.export,
        'This session cannot probe export codecs. Use the workspace Export control or a host with export support.',
      ],
    },
    inspect_transcription: {
      skills: ['transcription'],
      support: [
        capabilities.transcriptionStatus,
        'This session cannot inspect model readiness. Use the workspace transcription preparation control or a host with readiness support.',
      ],
    },
    // Individual service variants retain their own domain/support/permission checks below.
    propose_action: { skills: [] },
  } satisfies Record<ToolName, AccessRule>;
  const tools = Object.fromEntries(
    (Object.keys(schemas) as ToolName[]).map((name) => [
      name,
      access(rules[name]),
    ]),
  ) as Record<ToolName, ReturnType<typeof access>>;
  const serviceStates = Object.values(actions);
  tools.propose_action = {
    supported: serviceStates.some((state) => state.supported),
    available: serviceStates.some((state) => state.available),
    requiredSkills: [
      ...new Set(
        serviceStates
          .filter((state) => state.supported)
          .flatMap((state) => state.requiredSkills),
      ),
    ],
    blockers: serviceStates.some((state) => state.available)
      ? []
      : serviceStates
          .filter(
            (state) =>
              !serviceStates.some((item) => item.supported) || state.supported,
          )
          .flatMap((state) => state.blockers),
  };
  return { loadedSkills: [...loadedSkills], tools, actions };
}

export function toolDefinitions(
  includeTranscripts: boolean,
  capabilities: AssistantCapabilities,
  loadedSkills: ReadonlySet<SkillId> = new Set(),
  includeAssetIndexes = false,
  hasAssetIndexes = true,
): ToolDefinition[] {
  const descriptions: Record<ToolName, string> = {
    load_skill:
      'Load guidance and tools for one relevant request domain. Tools become available in the next round. Load additional skills only as needed; this never grants approval or sharing consent.',
    search_asset_index:
      'Search saved asset labels, including sound, and timestamped scenes for this project and explicitly allowed library assets. Read-only; no media or new inference.',
    read_asset_index:
      'Read paginated saved scene labels, representative and action timestamps for an authorized asset. Observations describe sampled evidence and may be incomplete.',
    inspect_storyboard:
      'Read paginated project storyboard geometry and styles. Text and frame names require text-sharing consent; no files or embedded content.',
    inspect_project:
      'Read the selected project snapshot. Times are integer microseconds and ranges are half-open. Names and text may be withheld.',
    inspect_asset:
      'Read metadata of an explicitly selected library asset or an asset referenced by the project. Includes capture.time (with provenance/offset if recorded) and capture.location (GPS) only with capture-sharing permission. Missing capture facts are unknown. No media bytes are available.',
    inspect_timeline:
      'Evaluate active clips at a timeline time: exact frame time, source positions, animated transforms, effects, audio gain, captions and transition weights. Structural metadata only; never renders or uploads a frame.',
    inspect_capabilities:
      'Read the complete capabilityMap for every known tool and service action, including host support, required skills, permission blockers and recovery. Also describes canonical edit properties/rules and approval boundaries. Read before claiming any workflow is unavailable.',
    search_text_library:
      'Search the shared text templates or font catalog by name/labels. Paginated read-only results include stable font IDs or complete template styles for insertClip/updateClip. Empty query browses every entry. No private text, media, downloads or inference.',
    inspect_transcription:
      'Check whether local transcription assets are cached. Does not download or initialize a model.',
    inspect_proposals:
      'Read pending/applied action state and sanitized result metadata. Never includes media, file paths or transcript text.',
    read_transcript:
      'Read source-relative transcript text explicitly shared for this project, including transcripts produced by approved local actions in this session.',
    validate_edits:
      'Dry-run an atomic edit batch with the canonical engine, returning affected IDs and the redacted resulting project. Does not commit or create a proposal. Use before proposing complex edits.',
    check_export:
      'Probe exact requested MP4/H.264/AAC or WebM/VP9/Opus settings in this browser. Read-only; does not encode or download a video.',
    propose_edits:
      'Propose an atomic edit batch for explicit user review. Does not apply edits. Covers every supported EditOperation, including transforms, effects, keyframes, text, captions and audio settings via updateClip. Use available asset IDs only. The host binds revision and request ID. Use unique IDs for new entities.',
    propose_action:
      'Propose a supported local action for explicit user approval. No service runs automatically and no media is uploaded.',
  };
  const discovery = capabilityDiscovery(
    includeTranscripts,
    capabilities,
    loadedSkills,
    includeAssetIndexes,
    hasAssetIndexes,
  );
  const permittedActions = allowedActions(capabilities, loadedSkills);
  return (Object.keys(schemas) as ToolName[])
    .filter((name) => discovery.tools[name].available)
    .map((name) => {
      const parameters = z.toJSONSchema(schemas[name], { io: 'input' });
      if (name === 'load_skill') {
        parameters.properties!.skillId = {
          type: 'string',
          enum: skillCatalog.map((skill) => skill.id),
        };
      }
      if (name === 'propose_action') {
        const variants = actionSchema.options.filter((variant) =>
          permittedActions.has(variant.shape.type.value),
        );
        // Each variant comes from the canonical action schema, narrowed to current authority.
        parameters.properties!.action = {
          anyOf: variants.map((variant) =>
            z.toJSONSchema(variant, { io: 'input' }),
          ),
        };
      }
      return {
        type: 'function' as const,
        function: {
          name,
          description:
            name === 'propose_action'
              ? `Propose one available action: ${[...permittedActions].join(', ')}. Nothing runs until explicit user approval. Indexing shares separately consented derived evidence and may incur cost; source files stay local. Save is a separate user action.`
              : descriptions[name],
          parameters,
        },
      };
    });
}

export function allowedActions(
  capabilities: AssistantCapabilities,
  loadedSkills: ReadonlySet<SkillId>,
) {
  const actions = capabilityDiscovery(
    false,
    capabilities,
    loadedSkills,
  ).actions;
  return new Set(
    (Object.keys(actions) as z.infer<typeof actionSchema>['type'][]).filter(
      (type) => actions[type].available,
    ),
  );
}

export function parseTool(
  name: string,
  argumentsJson: string,
): {
  name: ToolName;
  args: Record<string, unknown>;
} {
  aiInvariant(
    Object.hasOwn(schemas, name),
    'TOOL_NOT_ALLOWED',
    'Unknown assistant tool.',
  );
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new AiError(
      'INVALID_TOOL_ARGUMENTS',
      'Tool arguments must be valid JSON.',
    );
  }
  const result = schemas[name as ToolName].safeParse(value);
  if (!result.success)
    throw new AiError(
      'INVALID_TOOL_ARGUMENTS',
      'Tool arguments do not match the tool schema.',
      {
        issues: result.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path
            .filter(
              (part) =>
                typeof part === 'number' ||
                /^[a-zA-Z][a-zA-Z0-9_]*$/.test(String(part)),
            )
            .join('.'),
        })),
      },
    );
  return { name: name as ToolName, args: result.data };
}

/** Validate the complete atomic batch through the canonical core. */
export function proposalBatch(
  project: Project,
  input: unknown[],
  requestId: string,
  maxOperations: number,
  selectedAssetIds: readonly string[] = [],
  sessionTranscriptIds: readonly string[] = [],
): CommandBatch {
  aiInvariant(
    input.length <= maxOperations,
    'TOOL_LIMIT',
    'Too many operations in one proposal.',
  );
  const allowedAssets = new Set([...assetIds(project), ...selectedAssetIds]);
  const allowedTranscripts = new Set([
    ...project.tracks.flatMap((t) =>
      t.clips.flatMap((c) => (c.transcriptId ? [c.transcriptId] : [])),
    ),
    ...sessionTranscriptIds,
  ]);
  try {
    const batch = batchSchema.parse({
      projectId: project.id,
      requestId,
      expectedRevision: project.revision,
      operations: input,
    });
    const next = applyOperations(project, batch.operations).project;
    for (const track of next.tracks)
      for (const clip of track.clips) {
        aiInvariant(
          !clip.assetId || allowedAssets.has(clip.assetId),
          'TOOL_NOT_ALLOWED',
          'Proposals may only reference selected library assets or assets in the project.',
        );
        aiInvariant(
          !clip.transcriptId || allowedTranscripts.has(clip.transcriptId),
          'TOOL_NOT_ALLOWED',
          'Proposals may only reference transcripts in the selected project or this session.',
        );
      }
    return batch;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError(
      'EDIT_REJECTED',
      'The proposed batch is not a valid project edit. Inspect the project and verify IDs, source bounds, duration/speed, keyframe bounds and transition overlap.',
      error instanceof EditorError ? { editorCode: error.code } : {},
    );
  }
}

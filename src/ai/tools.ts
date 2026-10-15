import { storyboardImageOptionsSchema } from '../core/storyboard-image';
import { storyboardElementSchema } from '../core/storyboard';
import { libraryOperationSchema } from '../core/media-library';
import {
  storyboardExportOptionsSchema,
  storyboardStoreOptionsSchema,
} from '../core/storyboard-export';
import {
  COLOR_PRESETS,
  BLEND_MODES,
  colorLutSchema,
  maskSchema,
  eqSchema,
  chromaKeySchema,
} from '../core/effects';
import { z } from 'zod';
import { speechGenerationSchema } from './agent-speech';
import {
  codingOperations,
  codingQueries,
  codingOperationSchema,
  codingRevision,
} from '../core/coding';
import type { CodingOperation } from '../core/coding';
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
  z
    .object({
      type: z.literal('generate_speech'),
      options: speechGenerationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('coding'),
      operation: codingOperationSchema,
      expectedRevision: codingRevision,
    })
    .strict(),
  z
    .object({
      type: z.literal('insert_storyboard_image'),
      options: storyboardImageOptionsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('library'),
      operation: libraryOperationSchema,
      expectedRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z.object({ type: z.literal('undo') }).strict(),
  z.object({ type: z.literal('redo') }).strict(),
  z
    .object({ type: z.literal('export'), options: exportOptionsSchema })
    .strict(),
  z
    .object({
      type: z.literal('export_storyboard'),
      options: storyboardExportOptionsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('store_storyboard'),
      options: storyboardStoreOptionsSchema,
    })
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
  assetSchema.extend({
    type: z.literal('index_asset'),
    restart: z
      .boolean()
      .optional()
      .describe(
        'True only for an explicitly requested fresh reindex. Omit to resume a failed indexing request for this asset.',
      ),
  }),
  z.object({ type: z.literal('prepare_transcription') }).strict(),
  z
    .object({
      type: z.literal('track_mask'),
      clipId: z.string().min(1).max(200),
    })
    .strict(),
]);
const schemas = {
  inspect_coding_workspace: emptySchema,
  read_file: codingQueries.read_file.omit({ type: true }),
  glob: codingQueries.glob.omit({ type: true }),
  grep: codingQueries.grep.omit({ type: true }),
  write_file: codingOperations.write_file
    .omit({ type: true })
    .extend({ expectedRevision: codingRevision }),
  edit_file: codingOperations.edit_file
    .omit({ type: true })
    .extend({ expectedRevision: codingRevision }),
  bash: codingOperations.bash
    .omit({ type: true })
    .extend({ expectedRevision: codingRevision }),
  execute_code: codingOperations.execute_code
    .omit({ type: true })
    .extend({ expectedRevision: codingRevision }),
  import_workspace_file: codingOperations.import_workspace_file
    .omit({ type: true })
    .extend({ expectedRevision: codingRevision }),
  load_skill: z
    .object({
      skillId: z.enum([
        'editing',
        'storyboard',
        'export',
        'transcription',
        'indexing',
        'history',
        'coding',
        'speech',
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
  inspect_project: z
    .object({
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  inspect_library: z
    .object({
      folderId: z.string().min(1).max(200).nullable().optional(),
      recursive: z.boolean().default(true),
      includeTrashed: z.boolean().default(false),
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  resolve_library_assets: z
    .object({
      folderId: z.string().min(1).max(200).nullable(),
      recursive: z.boolean().default(true),
      expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  inspect_storyboard: z
    .object({
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      limit: z.number().int().min(1).max(100).default(20),
      detail: z.enum(['summary', 'full']).default('summary'),
    })
    .strict(),
  inspect_asset: assetSchema,
  inspect_timeline: z
    .object({
      timeUs: time,
      detail: z.enum(['evaluation', 'full']).default('evaluation'),
    })
    .strict(),
  inspect_capabilities: z
    .object({
      section: z
        .enum(['overview', 'properties', 'rules', 'all'])
        .default('overview'),
    })
    .strict(),
  search_text_library: z
    .object({
      kind: z.enum(['fonts', 'templates']),
      query: z.string().default(''),
      offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(10),
    })
    .strict(),
  inspect_transcription: emptySchema,
  inspect_speech: emptySchema,
  inspect_proposals: emptySchema,
  read_transcript: transcriptSchema,
  validate_edits: operationsSchema.extend({
    includeProject: z.boolean().optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
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
export function codingMutation(name: string) {
  return Object.hasOwn(codingOperations, name);
}
export function codingAction(name: string, args: Record<string, unknown>) {
  const { expectedRevision, ...input } = args;
  return {
    summary: `Project workspace: ${name}`,
    action: {
      type: 'coding' as const,
      expectedRevision: expectedRevision as number,
      operation: { ...input, type: name } as CodingOperation,
    },
  };
}
// Exhaustive classification: new tools must choose their scheduling contract.
const toolScheduling = {
  inspect_coding_workspace: 'read',
  read_file: 'read',
  glob: 'read',
  grep: 'read',
  write_file: 'serial',
  edit_file: 'serial',
  bash: 'serial',
  execute_code: 'serial',
  import_workspace_file: 'serial',
  load_skill: 'serial',
  resolve_library_assets: 'serial',
  propose_edits: 'serial',
  propose_action: 'action',
  check_export: 'serial',
  inspect_project: 'read',
  inspect_library: 'read',
  inspect_capabilities: 'read',
  inspect_proposals: 'read',
  inspect_storyboard: 'read',
  inspect_timeline: 'read',
  inspect_asset: 'read',
  inspect_transcription: 'read',
  inspect_speech: 'read',
  read_transcript: 'read',
  search_asset_index: 'read',
  read_asset_index: 'read',
  search_text_library: 'read',
  validate_edits: 'read',
} satisfies Record<ToolName, 'serial' | 'read' | 'action'>;

/** Sibling calls express independence; stateful calls remain ordering barriers.
 * No authority comes from this classification: execution still validates access. */
export function toolSchedulingGroup(tool: ReturnType<typeof parseTool>) {
  const mode = toolScheduling[tool.name];
  if (mode === 'read') return { kind: 'read' as const };
  if (mode === 'action') {
    const action = tool.args.action as z.infer<typeof actionSchema>;
    if (action.type === 'index_asset')
      return { kind: 'index' as const, resource: action.assetId };
  }
  return { kind: 'serial' as const };
}
export const supportedEditOperations =
  batchSchema.shape.operations.element.options.map(
    (operation) => operation.shape.type.value,
  );

export const editingProperties = {
  storyboard: {
    element: z.toJSONSchema(storyboardElementSchema, { io: 'input' }),
    export: z.toJSONSchema(storyboardExportOptionsSchema, { io: 'input' }),
    store: z.toJSONSchema(storyboardStoreOptionsSchema, { io: 'input' }),
    insertImage: z.toJSONSchema(storyboardImageOptionsSchema, { io: 'input' }),
  },
  effects: {
    presets: COLOR_PRESETS,
    blendModes: BLEND_MODES,
    lut: z.toJSONSchema(colorLutSchema),
    mask: z.toJSONSchema(maskSchema),
    equalizer: z.toJSONSchema(eqSchema),
    chromaKey: z.toJSONSchema(chromaKeySchema),
  },
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
  includeCodingWorkspace = false,
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
    generate_speech: access({
      skills: ['speech'],
      support: [
        !!capabilities.speech,
        'Connect a host with the configured OpenRouter speech generation service. TTS is distinct from transcription and coding.',
      ],
    }),
    coding: access({
      skills: ['coding'],
      support: [
        !!capabilities.coding,
        'Connect a host with the browser project coding workspace. Native tools are not required.',
      ],
      permission: [
        includeCodingWorkspace,
        'Enable includeCodingWorkspace in the headless context policy to share authored workspace sources and execution output.',
      ],
    }),
    library: access({
      skills: ['editing'],
      support: [
        !!capabilities.library,
        'Connect an editor with a media library to organize local folders.',
      ],
    }),
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
    export_storyboard: access({
      skills: ['storyboard'],
      support: [
        !!capabilities.storyboardExport,
        'Use the Storyboard export menu or connect a host with storyboard.export support. Timeline export is separate.',
      ],
    }),
    insert_storyboard_image: access({
      skills: ['storyboard'],
      support: [
        !!capabilities.storyboardInsertImage,
        'Use the Storyboard image menu or connect a host with storyboard.insertImage support.',
      ],
    }),
    store_storyboard: access({
      skills: ['storyboard'],
      support: [
        !!capabilities.storyboardStore,
        'Use Store PNG in Media or connect a host with storyboard.store support.',
      ],
    }),
    transcribe: access({
      skills: ['transcription'],
      support: [
        capabilities.transcription,
        'This session has no transcription executor. Use the workspace transcription control or a host with transcription support.',
      ],
    }),
    track_mask: access({
      skills: ['editing'],
      support: [
        !!capabilities.maskTracking,
        'This host has no mask tracker. Use the workspace Track mask control or connect an engine with masks.track support.',
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
        'Enable indexing consent and asset-index sharing in the host. The workspace authorizes indexing when OpenRouter is connected.',
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
      'Enable asset-index sharing in the host before reading saved labels. The workspace includes saved labels automatically.',
    ],
  };
  const rules = {
    inspect_coding_workspace: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    read_file: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    glob: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    grep: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    write_file: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    edit_file: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    bash: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    execute_code: {
      skills: ['coding'],
      support: [!!capabilities.coding, 'Use a host with a coding workspace.'],
    },
    import_workspace_file: {
      skills: ['coding'],
      support: [
        !!capabilities.coding,
        'Use a host with a coding workspace and media import.',
      ],
    },
    load_skill: { skills: [] },
    inspect_project: { skills: [] },
    inspect_library: {
      skills: ['editing', 'indexing'],
      support: [
        !!capabilities.library,
        'Connect an editor with media library storage.',
      ],
    },
    resolve_library_assets: {
      skills: ['editing', 'indexing'],
      support: [
        !!capabilities.library,
        'Connect an editor with media library storage.',
      ],
    },
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
    inspect_speech: {
      skills: ['speech'],
      support: [
        !!capabilities.speech,
        'Connect a host with speech model/voice discovery and generation.',
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
  for (const name of [
    'inspect_coding_workspace',
    'read_file',
    'glob',
    'grep',
    'write_file',
    'edit_file',
    'bash',
    'execute_code',
    'import_workspace_file',
  ] as const)
    Object.assign(rules[name], {
      permission: [
        includeCodingWorkspace,
        'Enable includeCodingWorkspace in the headless context policy. Workspace connection terms disclose authored source and execution output sharing.',
      ],
    });
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
  includeCodingWorkspace = false,
): ToolDefinition[] {
  const descriptions: Record<ToolName, string> = {
    inspect_coding_workspace:
      'Inspect the persistent project coding directory, revision, files and actual browser runtime capabilities. No code runs.',
    read_file:
      'Read an authored UTF-8 file within /project. Binary artifacts stay local; use code to analyze them.',
    glob: 'Find project workspace files matching *, ** and ? patterns. Defaults to every file.',
    grep: 'Search authored UTF-8 workspace files by regular expression, returning file paths, line numbers and text. Skips binary files.',
    write_file:
      'Write a complete UTF-8 workspace file at expectedRevision. Uses requested execution or a headless reviewable coding proposal.',
    edit_file:
      'Replace exact oldText in a workspace file at expectedRevision; ambiguous matches require replaceAll. Uses the shared coding action executor.',
    bash: 'Execute browser Bash against the project workspace at expectedRevision. Supports shell scripts/pipes/redirects/file/search tools and js. No native processes, network or package installation. Check exitCode; retained files appear in the completed receipt.',
    execute_code:
      'Run a saved JavaScript file in isolated QuickJS at expectedRevision, with optional argv args. Arbitrary composition/DSP supported through fs and writeWav; no browser globals or native Node. Sources and successful generated files persist locally.',
    import_workspace_file:
      'Import a saved generated media file at expectedRevision through the canonical asset and project library APIs. Returns assetId for timeline editing; no bytes are sent to the provider.',
    load_skill:
      'Load guidance and tools for one relevant request domain. Tools become available in the next round. Load additional skills only as needed; this never grants approval or sharing consent.',
    search_asset_index:
      'Search saved asset labels, including sound, and timestamped scenes for this project and explicitly allowed library assets. Read-only; no media or new inference.',
    read_asset_index:
      'Read paginated saved scene labels, representative and action timestamps for an authorized asset. Observations describe sampled evidence and may be incomplete.',
    inspect_storyboard:
      'Read storyboard summary pages (20 elements by default; limit up to 100). Follow nextOffset to see every element. Request detail full for original geometry/styles at the same offset. Text and frame names require text-sharing consent; no files or embedded content.',
    inspect_library:
      'Inspect registered project Media, optionally by folderId/recursive/offset/limit. Excludes Trash ancestry by default. Reports registered/authorized counts and childrenResolved; withheld assets are not empty folders. Names require sharing; no source files or bytes.',
    resolve_library_assets:
      'Resolve a requested project folder (folderId null means all project Media) to a deduplicated asset-ID manifest at expectedRevision, excluding Trash ancestry. No service runs. Trusted project-library access allows turn-local scope; otherwise the caller allowlist still filters assets. Report count/IDs before indexing; then use existing per-asset tools/actions.',
    inspect_project:
      'Read project settings/tracks and pages of clips and transitions (offset/limit, default 20, up to 100). Each pages entry reports total and nextOffset; follow every collection to inspect the entire project, including clip groupId membership. Track clipCount includes clips outside the page. Times are integer microseconds; names/text may be withheld.',
    inspect_asset:
      'Read metadata of an attached, project-referenced or currently resolved project-library asset. Includes capture.time (with provenance/offset if recorded) and capture.location (GPS) only with capture-sharing permission. Missing capture facts are unknown. No media bytes are available.',
    inspect_timeline:
      'Evaluate active clips at a timeline time: exact frame/source positions, animated values, effects, audio gain and transition weights. Default evaluation omits raw curves/cues; detail full includes them, or use inspect_project pages. Structural metadata only; no rendering/upload.',
    inspect_capabilities:
      'Read the complete capabilityMap and execution/permission blockers by default. Request section properties or rules for canonical editing schemas/recipes, or all for the full catalog. Read before claiming any workflow is unavailable.',
    search_text_library:
      'Search the shared text templates or font catalog by name/labels. Paginated read-only results include stable font IDs or complete template styles for insertClip/updateClip. Empty query browses every entry. No private text, media, downloads or inference.',
    inspect_speech:
      'Inspect advertised speech models/voices, configured selection, saved generated/user dictation voice references and phrase-timing readiness. No paid speech generation or raw media upload.',
    inspect_transcription:
      'Check whether local transcription assets are cached. Does not download or initialize a model.',
    inspect_proposals:
      'Read pending/applied action state and sanitized result metadata. Never includes media, file paths or transcript text.',
    read_transcript:
      'Read source-relative transcript text explicitly shared for this project, including transcripts produced by approved local actions in this session.',
    validate_edits:
      'Dry-run an atomic edit batch, returning expectedRevision and affectedIds without recopying the project. Set includeProject true only when a redacted dry-run preview is needed; offset/limit page clips/transitions as in inspect_project. No commit or proposal. Use before complex edits.',
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
    false,
    includeCodingWorkspace,
  );
  const permittedActions = allowedActions(
    capabilities,
    loadedSkills,
    includeCodingWorkspace,
  );
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
  includeCodingWorkspace = false,
) {
  const actions = capabilityDiscovery(
    false,
    capabilities,
    loadedSkills,
    false,
    true,
    false,
    includeCodingWorkspace,
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
    for (const assetId of assetIds(next))
      aiInvariant(
        allowedAssets.has(assetId),
        'TOOL_NOT_ALLOWED',
        'Proposals may only reference selected library assets or assets in the project.',
      );
    for (const track of next.tracks)
      for (const clip of track.clips) {
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

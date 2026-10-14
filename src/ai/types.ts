/** Text-only provider protocol. Media and credentials never enter conversation messages. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
/** Opaque provider continuation metadata; never rendered as assistant text. */
export type ReasoningDetail = {
  id?: string | null;
  format?: string;
  index?: number;
} & (
  | { type: 'reasoning.text'; text: string; signature?: string | null }
  | { type: 'reasoning.summary'; summary: string }
  | { type: 'reasoning.encrypted'; data: string }
);
export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
  reasoning?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: ReasoningDetail[];
}
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; content: string; tool_call_id: string };
export interface ChatRequest {
  /** Opaque workflow identity for OpenRouter grouping and sticky routing (max 256 characters). */
  sessionId?: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Omit to use the model's advertised allowance or provider default without an application cap. */
  maxOutputTokens?: number;
}
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
export type ProviderEvent =
  | { type: 'text'; text: string }
  | {
      type: 'complete';
      message: AssistantMessage;
      usage?: Usage;
      model?: string;
      generationId?: string;
    };
export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens?: number;
  supportedParameters: string[];
  supportsTools: boolean;
  inputModalities?: string[];
  /** Provider prices as decimal USD strings, without floating-point rounding. */
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}
export interface ConnectionStatus {
  connected: boolean;
}
export interface SpeechModel {
  id: string;
  name: string;
  voices: string[];
  /** Requires an explicitly selected reference recording. */
  referenceVoice?: boolean;
}
export interface SpeechReference {
  /** Base64 24 kHz mono PCM WAV; never a URL or project media handle. */
  data: string;
  transcript: string;
}
export interface SpeechRequest {
  sessionId?: string;
  model: string;
  script: string;
  voice: string;
  /** Languages present in the original script; synthesis never translates it. */
  languages: string[];
  instructions?: string;
  reference?: SpeechReference;
  elevenlabs?: import('./elevenlabs').ElevenLabsSettings;
}
export interface SpeechAudio {
  /** Normalized speech output: 24 kHz mono, finite samples in [-1, 1]. */
  samples: Float32Array;
  sampleRate: 24000;
}
export interface OpenRouterClient {
  status(): ConnectionStatus;
  setKey(key: string): void;
  disconnect(): void;
  /** Explicitly restore an optional local credential, without network activity. */
  restoreCredential(): ConnectionStatus;
  /** Explicit non-inference check of the OpenRouter credential. */
  verifyConnection?(signal?: AbortSignal): Promise<'credentials'>;
  listModels(signal?: AbortSignal): Promise<OpenRouterModel[]>;
  listSpeechModels(signal?: AbortSignal): Promise<SpeechModel[]>;
  /** Discover transcription choices without uploading audio or starting inference. */
  listTranscriptionModels?(
    signal?: AbortSignal,
  ): Promise<{ id: string; name: string }[]>;
  synthesizeSpeech(
    request: SpeechRequest,
    signal: AbortSignal,
  ): Promise<SpeechAudio>;
  /** Optional timestamp-capable OpenRouter STT, explicitly selected. */
  transcribeSpeech?(
    request: {
      model: string;
      audio: Float32Array;
      language?: string;
      sessionId?: string;
    },
    signal: AbortSignal,
  ): Promise<{ text: string; timestamp: [number, number] }[]>;
  stream(
    request: ChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
  dispose(): void;
}
/** Only the temporary PKCE verifier/state are stored here, never an API key. */
export type AuthorizationStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;
export interface AuthorizationOptions {
  /** Begin: return URL, with any hash kept locally. Complete: fragment-free URL including code and state. */
  callbackUrl: string;
  storage?: AuthorizationStorage;
}
export interface OpenRouter extends OpenRouterClient {
  label(
    request: IndexLabelRequest,
    signal: AbortSignal,
  ): Promise<IndexLabelResult>;
  beginAuthorization(
    options: AuthorizationOptions,
  ): Promise<{ authorizationUrl: string; expiresAt: number }>;
  completeAuthorization(
    options: AuthorizationOptions,
    signal?: AbortSignal,
  ): Promise<ConnectionStatus & { sanitizedCallbackUrl: string }>;
}
export interface IndexLabelRequest {
  sessionId?: string;
  model: string;
  prompt: string;
  media: { type: 'image/jpeg' | 'video/mp4' | 'audio/wav'; data: string }[];
  consent: true;
  maxOutputTokens: number;
}
export interface IndexLabelResult {
  text: string;
  model?: string;
  usage?: Usage;
  generationId?: string;
}
export interface OpenRouterOptions {
  fetch?: typeof fetch;
  /** Total time for one HTTP request, including a streamed response (default 120 s). */
  requestTimeoutMs?: number;
  /** Optional test/browser integration storage; resolved lazily on OAuth calls only. */
  oauthStorage?: AuthorizationStorage;
  /** Opt-in persistent credential store. Resolved only on connect/restore/disconnect. */
  credentialStorage?: () => AuthorizationStorage;
  now?: () => number;
}

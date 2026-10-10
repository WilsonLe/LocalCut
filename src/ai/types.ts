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
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
}
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}
export type ProviderEvent =
  | { type: 'text'; text: string }
  | {
      type: 'complete';
      message: AssistantMessage;
      usage?: Usage;
      model?: string;
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
  pricing?: { prompt?: string; completion?: string };
}
export interface ConnectionStatus {
  connected: boolean;
}
export interface SpeechModel {
  id: string;
  name: string;
  voices: string[];
}
export interface SpeechRequest {
  model: string;
  script: string;
  voice: string;
  /** Languages present in the original script; synthesis never translates it. */
  languages: string[];
  instructions?: string;
}
export interface SpeechAudio {
  /** Gemini speech output: signed 16-bit little-endian, 24 kHz mono. */
  samples: Float32Array;
  sampleRate: 24000;
}
export interface OpenRouterClient {
  status(): ConnectionStatus;
  setKey(key: string): void;
  disconnect(): void;
  listModels(signal?: AbortSignal): Promise<OpenRouterModel[]>;
  listSpeechModels(signal?: AbortSignal): Promise<SpeechModel[]>;
  synthesizeSpeech(
    request: SpeechRequest,
    signal: AbortSignal,
  ): Promise<SpeechAudio>;
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
  /** Begin: exact return URL. Complete: actual URL including code and state. */
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
}
export interface CompatibleEndpoint {
  baseUrl: string;
  /** Explicit user declaration: this chat model supports function tools. */
  model?: string;
  speechModel?: string;
  voices?: string[];
}
export interface OpenRouterOptions {
  /** Internal shared transport configuration; use createOpenAICompatible. */
  compatible?: CompatibleEndpoint;
  fetch?: typeof fetch;
  /** Total time for one HTTP request, including a streamed response (default 120 s). */
  requestTimeoutMs?: number;
  /** Optional test/browser integration storage; resolved lazily on OAuth calls only. */
  oauthStorage?: AuthorizationStorage;
  now?: () => number;
}

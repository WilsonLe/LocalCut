/** Optional AI entry. Importing this module never starts work or opens storage. */
export { createOpenRouter } from './openrouter';
export { createAssistant } from './assistant';
export { createAssetIndexer } from './asset-indexer';
export type { AssetIndexerOptions } from './asset-indexer';
export { AiError } from './errors';
export { renderSpeech, validateSpeechTiming } from './speech-audio';
export type { SpeechTiming, RenderedSpeech } from './speech-audio';
export type { AiErrorCode } from './errors';
export type * from './types';
export type * from './assistant';
export type * from './context';

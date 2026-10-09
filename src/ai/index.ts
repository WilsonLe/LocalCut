/** Optional AI entry. Importing this module never starts work or opens storage. */
export { createOpenRouter } from './openrouter';
export { createAssistant } from './assistant';
export { AiError } from './errors';
export type { AiErrorCode } from './errors';
export type * from './types';
export type * from './assistant';
export type * from './context';

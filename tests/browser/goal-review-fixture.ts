import type { Page } from '@playwright/test';
import type { AssistantMessage, ChatRequest } from '../../src/ai/types';
import { goalReviewReply } from '../goal-review-fixture';

declare global {
  interface Window {
    localcutGoalReviewReply: (
      request: Pick<ChatRequest, 'messages' | 'tools'>,
    ) => Promise<AssistantMessage | undefined>;
  }
}

/** Legacy production-entry scripts retain their execution rounds and native
 * assertions. Auxiliary replies use synthetic data only, independently of them. */
export async function installGoalReviewFixture(page: Page) {
  await page.exposeFunction('localcutGoalReviewReply', goalReviewReply);
}

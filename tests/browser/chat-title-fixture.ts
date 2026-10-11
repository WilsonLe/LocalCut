import { expect } from '@playwright/test';
import type { Route } from '@playwright/test';

/** Keep auxiliary naming separate from editing reply/failure fixtures and counts. */
export async function fulfillChatTitle(route: Route): Promise<boolean> {
  if (route.request().method() !== 'POST') return false;
  const body = route.request().postDataJSON();
  if (body.tools?.length !== 0 || body.messages?.[0]?.role !== 'system')
    return false;
  expect(body.max_tokens).toBe(512);
  expect(body.messages).toHaveLength(2);
  expect(body.messages[1]).toMatchObject({
    role: 'user',
    content: expect.any(String),
  });
  expect(body).not.toHaveProperty('tool_choice');
  await route.fulfill({
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Editing session title' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  });
  return true;
}

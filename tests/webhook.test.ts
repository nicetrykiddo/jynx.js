import { describe, expect, it } from 'vitest';
import { isWebhookRequest } from '../src/telegram/webhook.js';

describe('webhook request routing', () => {
  it('accepts only POST requests to the configured path', () => {
    expect(isWebhookRequest('POST', '/jynx/secret', '/jynx/secret')).toBe(true);
    expect(isWebhookRequest('GET', '/jynx/secret', '/jynx/secret')).toBe(false);
    expect(isWebhookRequest('POST', '/jynx/wrong', '/jynx/secret')).toBe(false);
  });
});

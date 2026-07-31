import { describe, expect, it } from 'vitest';
import { telegramHtml } from '../src/core/reporter.js';

describe('telegramHtml', () => {
  it('renders basic model markdown safely for Telegram', () => {
    expect(telegramHtml('- **Users:** 1 & <safe>')).toBe('• <b>Users:</b> 1 &amp; &lt;safe&gt;');
  });

  it('stays within Telegram limits after HTML escaping', () => {
    expect(telegramHtml('&'.repeat(4000))).toHaveLength(3500);
  });
});

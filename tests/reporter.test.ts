import { describe, expect, it } from 'vitest';
import { telegramHtml } from '../src/core/reporter.js';

describe('telegramHtml', () => {
  it('renders basic model markdown safely for Telegram', () => {
    expect(telegramHtml('- **Users:** 1 & <safe>')).toBe('• <b>Users:</b> 1 &amp; &lt;safe&gt;');
  });

  it('stays within Telegram limits after HTML escaping', () => {
    expect(telegramHtml('&'.repeat(4000))).toHaveLength(3500);
  });

  it('renders model headings, emphasis, code, and links as Telegram HTML', () => {
    expect(
      telegramHtml(
        '# Reviews for *Agent Kim*\n## Ratings\n- **IMDb:** `7.7/10`\n[Netflix](https://netflix.com/title?id=1&x=2)',
      ),
    ).toBe(
      '<b>Reviews for <i>Agent Kim</i></b>\n<b>Ratings</b>\n• <b>IMDb:</b> <code>7.7/10</code>\n<a href="https://netflix.com/title?id=1&amp;x=2">Netflix</a>',
    );
  });

  it('escapes HTML inside fenced code blocks', () => {
    expect(telegramHtml('```ts\nconst value = "<unsafe>";\n```')).toBe(
      '<pre><code>const value = &quot;&lt;unsafe&gt;&quot;;</code></pre>',
    );
  });
});

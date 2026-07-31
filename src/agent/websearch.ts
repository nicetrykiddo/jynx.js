import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchService {
  public constructor(
    private readonly config: Pick<
      AppConfig,
      'WEB_SEARCH_API_KEY' | 'WEB_SEARCH_BASE_URL' | 'WEB_SEARCH_MAX_RESULTS' | 'LOG_TOOL_OUTPUTS'
    >,
    private readonly logger: Logger,
  ) {}

  public get isConfigured(): boolean {
    return Boolean(this.config.WEB_SEARCH_API_KEY);
  }

  public async search(query: string): Promise<SearchResult[]> {
    if (!this.isConfigured) {
      throw new Error('web search is not configured (set WEB_SEARCH_API_KEY)');
    }

    const response = await fetch(`${this.config.WEB_SEARCH_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.config.WEB_SEARCH_API_KEY,
        query,
        max_results: this.config.WEB_SEARCH_MAX_RESULTS,
        search_depth: 'basic',
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`web search failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const results = Array.isArray(data.results) ? data.results : [];
    this.logger.info(
      this.config.LOG_TOOL_OUTPUTS ? { query, count: results.length } : { count: results.length },
      'web search',
    );

    return results.slice(0, this.config.WEB_SEARCH_MAX_RESULTS).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.content ?? '').slice(0, 500),
    }));
  }
}

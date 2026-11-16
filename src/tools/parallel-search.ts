import { createParser } from 'eventsource-parser';
import { z } from 'zod';
import { name, version } from '../../package.json';
import type { SERPQuery, UnNormalizedSearchSnippet } from '../types';
import { formatDateRange } from '../utils/date-tools';

const endpoint = 'https://mcp.parallel.ai/mcp';
const protocolVersion = '2025-06-18';
const maxResponseBytes = 10 * 1024 * 1024;

const replySchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.unknown(),
  error: z.object({ code: z.number() }).optional(),
});

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
});

const searchResultsSchema = z.object({ results: z.array(z.unknown()) });
const resultSchema = z.object({
  url: z.string().url().regex(/^https?:\/\//i),
  title: z.string().nullish(),
  excerpts: z.array(z.string()),
  publish_date: z.string().nullish(),
});

function matchReply(text: string, id: number) {
  const reply = replySchema.safeParse(JSON.parse(text));
  if (reply.success && reply.data.id === id &&
      (reply.data.error || reply.data.result !== undefined)) {
    return reply.data;
  }
}

async function readReply(response: Response, id: number): Promise<unknown> {
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Parallel MCP returned an empty response');

  try {
    if (mediaType !== 'text/event-stream' && mediaType !== 'application/json') {
      throw new Error('Parallel MCP returned an unsupported response type');
    }

    let reply: ReturnType<typeof matchReply>;
    const parser = createParser({
      onEvent: ({ data }) => { reply ??= matchReply(data, id); },
    });
    const decoder = new TextDecoder();
    let receivedBytes = 0;
    let json = '';

    while (!reply) {
      const { value, done } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxResponseBytes) throw new Error('Parallel MCP response is too large');

      const text = decoder.decode(value, { stream: true });
      if (mediaType === 'text/event-stream') parser.feed(text);
      else json += text;
    }

    if (mediaType === 'application/json') reply = matchReply(json + decoder.decode(), id);
    if (!reply) throw new Error('Parallel MCP did not return a reply');
    if (reply.error) throw new Error(`Parallel MCP request failed (code ${reply.error.code})`);
    return reply.result;
  } finally {
    // An SSE stream can stay open after the matching reply.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function discardBody(response: Response) {
  void response.body?.cancel().catch(() => undefined);
}

export async function parallelSearch(query: SERPQuery): Promise<UnNormalizedSearchSnippet[]> {
  const q = query.q.trim();
  if (!q) return [];

  const headers = new Headers({
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'User-Agent': `${name}/${version}`,
  });
  const signal = AbortSignal.timeout(20_000);

  async function post(message: object): Promise<Response> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      discardBody(response);
      throw new Error(`Parallel MCP returned HTTP ${response.status}`);
    }
    return response;
  }

  try {
    const initialization = await post({
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: {}, clientInfo: { name, version } },
    });
    const sessionId = initialization.headers.get('mcp-session-id');
    if (sessionId) headers.set('Mcp-Session-Id', sessionId);
    const initialized = z.object({ protocolVersion: z.literal(protocolVersion) })
      .parse(await readReply(initialization, 1));
    headers.set('MCP-Protocol-Version', initialized.protocolVersion);

    discardBody(await post({ method: 'notifications/initialized' }));

    const dateRange = formatDateRange(query);
    const objective = [q, query.location, dateRange].filter(Boolean).join('. ');
    const response = await post({
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search', arguments: { objective, search_queries: [q] } },
    });
    const result = toolResultSchema.parse(await readReply(response, 2));
    if (result.isError) throw new Error('Parallel web_search failed');

    const text = result.content?.find(item => item.type === 'text')?.text;
    const payload = result.structuredContent ?? (text ? JSON.parse(text) : undefined);
    return searchResultsSchema.parse(payload).results.flatMap(item => {
      const parsed = resultSchema.safeParse(item);
      if (!parsed.success) return [];
      const { url, title, excerpts, publish_date } = parsed.data;
      const description = excerpts.join('\n\n').trim();
      if (!description) return [];
      return [{ url, title: title?.trim() || url, description, date: publish_date || undefined }];
    });
  } finally {
    if (headers.has('Mcp-Session-Id')) {
      const cleanup = await fetch(endpoint, {
        method: 'DELETE',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(1_000),
      }).catch(() => undefined);
      if (cleanup) discardBody(cleanup);
    }
  }
}

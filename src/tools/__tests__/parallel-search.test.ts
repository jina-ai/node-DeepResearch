import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { parallelSearch } from '../parallel-search';
import { name, version } from '../../../package.json';

type Call = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: { method?: string; id?: number; params?: unknown };
};

const result = {
  results: [
    {
      url: 'https://science.nasa.gov/mission/europa-clipper/',
      title: null,
      excerpts: ['First excerpt 📚\u2028and the same line.', 'Second excerpt.'],
      publish_date: '2024-10-14',
    },
    { url: 'file:///private', title: 'Invalid', excerpts: ['Discard this result'] },
  ],
};

function json(response: ServerResponse, id: number, result: unknown) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

describe('Parallel search', () => {
  let server: Server;
  let redirectTarget: Server;
  let redirectHits: number;
  let calls: Call[];
  let handleSearch: (response: ServerResponse, id: number) => void;
  let handleDelete: (response: ServerResponse) => void;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    calls = [];
    redirectHits = 0;
    handleDelete = response => response.writeHead(204).end();
    handleSearch = (response, id) => json(response, id, { structuredContent: result });

    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      calls.push({ method: request.method || '', headers: request.headers, body });

      if (body.method === 'initialize') {
        response.setHeader('Mcp-Session-Id', 'fixture-session');
        json(response, body.id, { protocolVersion: '2025-06-18' });
      } else if (body.method === 'notifications/initialized') {
        response.writeHead(202).end();
      } else if (body.method === 'tools/call') {
        handleSearch(response, body.id);
      } else if (request.method === 'DELETE') {
        handleDelete(response);
      } else {
        response.writeHead(405).end();
      }
    });
    redirectTarget = createServer((request, response) => {
      redirectHits++;
      request.resume();
      response.writeHead(204).end();
    });
    await Promise.all([server, redirectTarget].map(origin =>
      new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))));
    const fetch = globalThis.fetch;
    const address = server.address() as AddressInfo;
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (input !== 'https://mcp.parallel.ai/mcp') throw new Error('Unexpected destination');
      return fetch('http://127.0.0.1:' + address.port + '/mcp', init);
    });
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await Promise.all([server, redirectTarget].map(origin => new Promise<void>(resolve => {
      origin.close(() => resolve());
      origin.closeAllConnections();
    })));
  });

  it('sends project attribution and no authorization, then normalizes search results', async () => {
    const q = 'Europa Clipper site:science.nasa.gov OR site:jpl.nasa.gov';
    const entries = await parallelSearch({ q, location: 'United States', tbs: 'qdr:w' });
    expect(entries).toEqual([{
      url: result.results[0].url,
      title: result.results[0].url,
      description: result.results[0].excerpts.join('\n\n'),
      date: '2024-10-14',
    }]);
    expect(calls.map(call => call.body.method || call.method))
      .toEqual(['initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
    for (const [index, call] of calls.entries()) {
      expect(call.headers['user-agent']).toBe(name + '/' + version);
      expect(call.headers.authorization).toBeUndefined();
      if (index > 0) {
        expect(call.headers['mcp-session-id']).toBe('fixture-session');
        expect(call.headers['mcp-protocol-version']).toBe('2025-06-18');
      }
    }
    expect(calls[2].body.params).toEqual({
      name: 'web_search',
      arguments: {
        objective: expect.stringContaining(q + '. United States. Between '),
        search_queries: [q],
      },
    });
  });

  it('returns the matching SSE response while the server keeps the stream open', async () => {
    handleSearch = (response, id) => {
      response.writeHead(200, { 'Content-Type': 'Text/Event-Stream; charset=utf-8' });
      const body = Buffer.from([
        ': heartbeat\r\n\r\n',
        'data: {"jsonrpc":"2.0","id":999,"result":null}\r\n\r\n',
        'data: {"jsonrpc":"2.0","id":' + id + ',\r\n',
        'data: "result":' + JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }) + '}\r\n\r\n',
      ].join(''));
      const split = body.indexOf(Buffer.from('📚')) + 1;
      response.write(body.subarray(0, split));
      setImmediate(() => response.write(body.subarray(split)));
    };
    const entries = await parallelSearch({ q: 'Europa Clipper' });
    expect(entries[0].description).toContain('📚\u2028and the same line.');
    expect(calls.at(-1)?.method).toBe('DELETE');
  }, 4_000);

  it('returns the RPC error even when both the result stream and cleanup stay open', async () => {
    handleSearch = (response, id) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: ' + JSON.stringify({
        jsonrpc: '2.0', id, error: { code: -32603, message: 'Private detail' },
      }) + '\n\n');
    };
    handleDelete = response => response.writeHead(200);
    await expect(parallelSearch({ q: 'Europa Clipper' })).rejects.toThrow('code -32603');
    expect(calls.at(-1)?.method).toBe('DELETE');
  }, 4_000);

  it('rejects redirects from the search and session cleanup', async () => {
    const address = redirectTarget.address() as AddressInfo;
    handleSearch = handleDelete = response => response.writeHead(307, {
      Location: 'http://127.0.0.1:' + address.port + '/other',
    }).end();
    await expect(parallelSearch({ q: 'Europa Clipper' })).rejects.toThrow();
    expect(calls.at(-1)?.method).toBe('DELETE');
    expect(redirectHits).toBe(0);
  });

  it('rejects a compressed response that exceeds the decoded size limit', async () => {
    handleSearch = (response, id) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      response.end(gzipSync(JSON.stringify({
        jsonrpc: '2.0', id, result: 'x'.repeat(10 * 1024 * 1024),
      })));
    };
    await expect(parallelSearch({ q: 'Europa Clipper' })).rejects.toThrow('response is too large');
    expect(calls.at(-1)?.method).toBe('DELETE');
  });

  it('skips empty queries before making a connection', async () => {
    await expect(parallelSearch({ q: '  ' })).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

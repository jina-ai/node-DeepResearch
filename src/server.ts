import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import { getResponse } from './agent';

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for localhost debugging
app.use(cors());
app.use(express.json());

// Create event emitter for SSE
const eventEmitter = new EventEmitter();

// Type definitions
interface QueryRequest extends Request {
  body: {
    q: string;
    budget?: number;
    maxBadAttempt?: number;
  };
}

interface StreamResponse extends Response {
  write: (chunk: string) => boolean;
}

// SSE endpoint for progress updates
app.get('/api/v1/stream/:requestId', ((req: Request, res: StreamResponse) => {
  const requestId = req.params.requestId;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventEmitter.on(`progress-${requestId}`, listener);

  req.on('close', () => {
    eventEmitter.removeListener(`progress-${requestId}`, listener);
  });
}) as RequestHandler);

// POST endpoint to handle questions
app.post('/api/v1/query', (async (req: QueryRequest, res: Response) => {
  const { q, budget, maxBadAttempt } = req.body;
  if (!q) {
    return res.status(400).json({ error: 'Query (q) is required' });
  }

  const requestId = Date.now().toString();
  res.json({ requestId });

  // Store original console.log
  const originalConsoleLog: typeof console.log = console.log;

  try {
    // Wrap getResponse to emit progress
    console.log = (...args: any[]) => {
      originalConsoleLog(...args);
      const message = args.join(' ');
      if (message.includes('Step') || message.includes('Budget used')) {
        eventEmitter.emit(`progress-${requestId}`, { type: 'progress', data: message });
      }
    };

    const result = await getResponse(q, budget, maxBadAttempt);
    eventEmitter.emit(`progress-${requestId}`, { type: 'answer', data: result });
  } catch (error: any) {
    eventEmitter.emit(`progress-${requestId}`, { type: 'error', data: error?.message || 'Unknown error' });
  } finally {
    console.log = originalConsoleLog;
  }
}) as RequestHandler);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;

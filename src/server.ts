import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';
import { getResponse } from './agent';
import { tokenTracker } from './utils/token-tracker';
import { StepAction } from './types';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for localhost debugging
app.use(cors());
app.use(express.json());

// Create event emitter for SSE
const eventEmitter = new EventEmitter();

// Type definitions
import { StreamMessage } from './types';

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

  const listener = (data: StreamMessage) => {
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
  let thisStep: StepAction | undefined;

  try {
    // Wrap getResponse to emit progress
    console.log = (...args: any[]) => {
      originalConsoleLog(...args);
      const message = args.join(' ');
      if (message.includes('Step') || message.includes('Budget used')) {
        const step = parseInt(message.match(/Step (\d+)/)?.[1] || '0');
        const budgetPercentage = message.match(/Budget used ([\d.]+)%/)?.[1];
        const budgetInfo = budgetPercentage ? {
          used: tokenTracker.getTotalUsage(),
          total: budget || 1_000_000,
          percentage: budgetPercentage
        } : undefined;
        
        // Emit the full thisStep object if available
        if (thisStep && thisStep.action && thisStep.thoughts) {
          eventEmitter.emit(`progress-${requestId}`, {
            type: 'progress',
            data: thisStep,
            step,
            budget: budgetInfo
          });
        } else {
          eventEmitter.emit(`progress-${requestId}`, {
            type: 'progress',
            data: message,
            step,
            budget: budgetInfo
          });
        }
      }
    };

    // Track step updates during execution
    const emitStep = (step: StepAction & { totalStep?: number }) => {
      if (step.action && step.thoughts) {
        eventEmitter.emit(`progress-${requestId}`, {
          type: 'progress',
          data: step,
          step: step.totalStep,
          budget: {
            used: tokenTracker.getTotalUsage(),
            total: budget || 1_000_000,
            percentage: ((tokenTracker.getTotalUsage() / (budget || 1_000_000)) * 100).toFixed(2)
          }
        });
      }
    };

    // Override console.log to track steps
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      originalConsoleLog(...args);
      const message = args.join(' ');
      if (message.includes('Step') || message.includes('Budget used')) {
        const step = parseInt(message.match(/Step (\d+)/)?.[1] || '0');
        const budgetPercentage = message.match(/Budget used ([\d.]+)%/)?.[1];
        const budgetInfo = budgetPercentage ? {
          used: tokenTracker.getTotalUsage(),
          total: budget || 1_000_000,
          percentage: budgetPercentage
        } : undefined;
        
        if (thisStep && thisStep.action && thisStep.thoughts) {
          emitStep({...thisStep, totalStep: step});
        } else {
          eventEmitter.emit(`progress-${requestId}`, {
            type: 'progress',
            data: message,
            step,
            budget: budgetInfo
          });
        }
      }
    };

    const result = await getResponse(q, budget, maxBadAttempt);
    thisStep = result;
    await storeTaskResult(requestId, result);
    eventEmitter.emit(`progress-${requestId}`, { type: 'answer', data: result });
  } catch (error: any) {
    eventEmitter.emit(`progress-${requestId}`, { type: 'error', data: error?.message || 'Unknown error' });
  } finally {
    console.log = originalConsoleLog;
  }
}) as RequestHandler);

async function storeTaskResult(requestId: string, result: StepAction) {
  try {
    const taskDir = path.join(process.cwd(), 'tasks');
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(
      path.join(taskDir, `${requestId}.json`),
      JSON.stringify(result, null, 2)
    );
  } catch (error) {
    console.error('Task storage failed:', error);
  }
}

// GET endpoint to fetch task results
app.get('/api/v1/task/:requestId', (async (req: Request, res: Response) => {
  const requestId = req.params.requestId;
  try {
    const taskPath = path.join(process.cwd(), 'tasks', `${requestId}.json`);
    const taskData = await fs.readFile(taskPath, 'utf-8');
    res.json(JSON.parse(taskData));
  } catch (error) {
    res.status(404).json({ error: 'Task not found' });
  }
}) as RequestHandler);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;

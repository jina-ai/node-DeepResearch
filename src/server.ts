import express, {Request, Response, RequestHandler} from 'express';
import cors from 'cors';
import {EventEmitter} from 'events';
import {getResponse} from './agent';
import {
  StepAction,
  StreamMessage,
  TrackerContext,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AnswerAction
} from './types';
import { OPENAI_API_KEY } from './config';
import fs from 'fs/promises';
import path from 'path';
import {TokenTracker} from "./utils/token-tracker";
import {ActionTracker} from "./utils/action-tracker";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const eventEmitter = new EventEmitter();

interface QueryRequest extends Request {
  body: {
    q: string;
    budget?: number;
    maxBadAttempt?: number;
  };
}

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', (async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || auth.split(' ')[1] !== OPENAI_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body as ChatCompletionRequest;
  if (!body.messages?.length) {
    return res.status(400).json({ error: 'Messages array is required and must not be empty' });
  }
  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage.role !== 'user') {
    return res.status(400).json({ error: 'Last message must be from user' });
  }

  const requestId = Date.now().toString();
  const context: TrackerContext = {
    tokenTracker: new TokenTracker(),
    actionTracker: new ActionTracker()
  };

  // Track prompt tokens for the initial message
  if (body?.messages) {
    const promptTokens = Buffer.byteLength(JSON.stringify(body.messages), 'utf-8');
    context.tokenTracker.trackUsage('agent', promptTokens, 'prompt');
  }

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial chunk
    const initialChunk: ChatCompletionChunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      system_fingerprint: 'fp_' + requestId,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        logprobs: null,
        finish_reason: null
      }]
    };
    res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

    // Set up progress listener
    context.actionTracker.on('action', (action) => {
      // Track completion tokens for each chunk
      const chunkTokens = Buffer.byteLength(action.think, 'utf-8');
      context.tokenTracker.trackUsage('agent', chunkTokens, 'completion');
      const chunk: ChatCompletionChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        system_fingerprint: 'fp_' + requestId,
        choices: [{
          index: 0,
          delta: { content: action.think },
          logprobs: null,
          finish_reason: null
        }]
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });
  }

  try {
    // Track initial query tokens
    const queryTokens = Buffer.byteLength(lastMessage.content, 'utf-8');
    context.tokenTracker.trackUsage('agent', queryTokens, 'prompt');

    const { result } = await getResponse(lastMessage.content, undefined, undefined, context);
    
    // Track reasoning tokens from evaluator and completion tokens
    if (result.action === 'answer') {
      // Track reasoning tokens from the think step
      const reasoningTokens = Buffer.byteLength(result.think, 'utf-8');
      context.tokenTracker.trackUsage('evaluator', reasoningTokens, 'reasoning');
      
      // Track completion tokens for the final answer
      const completionTokens = Buffer.byteLength((result as AnswerAction).answer, 'utf-8');
      context.tokenTracker.trackUsage('agent', completionTokens, 'completion');

      // Track accepted prediction tokens since this was a successful answer
      context.tokenTracker.trackUsage('evaluator', completionTokens, 'accepted');
    } else {
      // Track rejected prediction tokens for non-answer responses
      const rejectedTokens = Buffer.byteLength(result.think, 'utf-8');
      context.tokenTracker.trackUsage('evaluator', rejectedTokens, 'rejected');
    }

    if (body.stream) {
      // Send final chunk
      const finalChunk: ChatCompletionChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        system_fingerprint: 'fp_' + requestId,
        choices: [{
          index: 0,
          delta: {},
          logprobs: null,
          finish_reason: 'stop'
        }]
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.end();
    } else {
      const response: ChatCompletionResponse = {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        system_fingerprint: 'fp_' + requestId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.action === 'answer' ? (result as AnswerAction).answer : result.think
          },
          logprobs: null,
          finish_reason: 'stop'
        }],
        usage: context.tokenTracker.getOpenAIUsage()
      };
      res.json(response);
    }
  } catch (error: any) {
    // Track error as rejected tokens
    const errorMessage = error?.message || 'An error occurred';
    const errorTokens = Buffer.byteLength(errorMessage, 'utf-8');
    context.tokenTracker.trackUsage('evaluator', errorTokens, 'rejected');

    res.status(500).json({
      error: {
        message: errorMessage,
        type: 'internal_server_error'
      }
    });
  }
}) as RequestHandler);

interface StreamResponse extends Response {
  write: (chunk: string) => boolean;
}

function createProgressEmitter(requestId: string, budget: number | undefined, context: TrackerContext) {
  return () => {
    const state = context.actionTracker.getState();
    const budgetInfo = {
      used: context.tokenTracker.getTotalUsage(),
      total: budget || 1_000_000,
      percentage: ((context.tokenTracker.getTotalUsage() / (budget || 1_000_000)) * 100).toFixed(2)
    };

    eventEmitter.emit(`progress-${requestId}`, {
      type: 'progress',
      data: {...state.thisStep, totalStep: state.totalStep},
      step: state.totalStep,
      budget: budgetInfo,
      trackers: {
        tokenUsage: context.tokenTracker.getTotalUsage(),
        actionState: context.actionTracker.getState()
      }
    });
  };
}

function cleanup(requestId: string) {
  const context = trackers.get(requestId);
  if (context) {
    context.actionTracker.removeAllListeners();
    context.tokenTracker.removeAllListeners();
    trackers.delete(requestId);
  }
}

function emitTrackerUpdate(requestId: string, context: TrackerContext) {
  const trackerData = {
    tokenUsage: context.tokenTracker.getTotalUsage(),
    tokenBreakdown: context.tokenTracker.getUsageBreakdown(),
    actionState: context.actionTracker.getState().thisStep,
    step: context.actionTracker.getState().totalStep,
    badAttempts: context.actionTracker.getState().badAttempts,
    gaps: context.actionTracker.getState().gaps
  };

  eventEmitter.emit(`progress-${requestId}`, {
    type: 'progress',
    trackers: trackerData
  });
}

// Store the trackers for each request
const trackers = new Map<string, TrackerContext>();

app.post('/api/v1/query', (async (req: QueryRequest, res: Response) => {
  const {q, budget, maxBadAttempt} = req.body;
  if (!q) {
    return res.status(400).json({error: 'Query (q) is required'});
  }

  const requestId = Date.now().toString();

  // Create new trackers for this request
  const context: TrackerContext = {
    tokenTracker: new TokenTracker(),
    actionTracker: new ActionTracker()
  };
  trackers.set(requestId, context);

  // Set up listeners immediately for both trackers
  context.actionTracker.on('action', () => emitTrackerUpdate(requestId, context));
  // context.tokenTracker.on('usage', () => emitTrackerUpdate(requestId, context));

  res.json({requestId});

  try {
    const {result} = await getResponse(q, budget, maxBadAttempt, context);
    const emitProgress = createProgressEmitter(requestId, budget, context);
    context.actionTracker.on('action', emitProgress);
    await storeTaskResult(requestId, result);
    eventEmitter.emit(`progress-${requestId}`, {
      type: 'answer',
      data: result,
      trackers: {
        tokenUsage: context.tokenTracker.getTotalUsage(),
        actionState: context.actionTracker.getState()
      }
    });
    cleanup(requestId);
  } catch (error: any) {
    eventEmitter.emit(`progress-${requestId}`, {
      type: 'error',
      data: error?.message || 'Unknown error',
      status: 500,
      trackers: {
        tokenUsage: context.tokenTracker.getTotalUsage(),
        actionState: context.actionTracker.getState()
      }
    });
    cleanup(requestId);
  }
}) as RequestHandler);

app.get('/api/v1/stream/:requestId', (async (req: Request, res: StreamResponse) => {
  const requestId = req.params.requestId;
  const context = trackers.get(requestId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (data: StreamMessage) => {
    // The trackers are now included in all event types
    // We don't need to add them here as they're already part of the data
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventEmitter.on(`progress-${requestId}`, listener);

  // Handle client disconnection
  req.on('close', () => {
    eventEmitter.removeListener(`progress-${requestId}`, listener);
  });

  // Send initial connection confirmation with tracker state
  const initialData = {
    type: 'connected',
    requestId,
    trackers: context ? {
      tokenUsage: context.tokenTracker.getTotalUsage(),
      actionState: context.actionTracker.getState()
    } : null
  };
  res.write(`data: ${JSON.stringify(initialData)}\n\n`);
}) as RequestHandler);

async function storeTaskResult(requestId: string, result: StepAction) {
  try {
    const taskDir = path.join(process.cwd(), 'tasks');
    await fs.mkdir(taskDir, {recursive: true});
    await fs.writeFile(
      path.join(taskDir, `${requestId}.json`),
      JSON.stringify(result, null, 2)
    );
  } catch (error) {
    console.error('Task storage failed:', error);
    throw new Error('Failed to store task result');
  }
}

app.get('/api/v1/task/:requestId', (async (req: Request, res: Response) => {
  const requestId = req.params.requestId;
  try {
    const taskPath = path.join(process.cwd(), 'tasks', `${requestId}.json`);
    const taskData = await fs.readFile(taskPath, 'utf-8');
    res.json(JSON.parse(taskData));
  } catch (error) {
    res.status(404).json({error: 'Task not found'});
  }
}) as RequestHandler);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;

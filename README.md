# DeepResearch

Keep searching and reading webpages until finding the answer (or exceeding the token budget).

Query: `"who is the biggest? cohere, jina ai, voyage?"` - 13 steps
![example-biggest](example-biggest.gif)

## Install

We use gemini for llm, brave/duckduckgo for search, jina reader for reading a webpage.

```bash
export GEMINI_API_KEY=...  # for gemini api, ask han
export JINA_API_KEY=jina_...  # free jina api key, get from https://jina.ai/reader
export BRAVE_API_KEY=...  # (optional, when not given it uses duckduckgo) brave search provide free key, ask han

git clone https://github.com/piktur/node-DeepResearch.git
cd node-DeepResearch
pnpm install
```

## Run

### Example: no tool calling

```sh
docker compose run -it --rm api pnpm run dev "1+1="
```

```sh
docker compose run -it --rm api pnpm dev "what is the capital of France?"
```

### Example: 2-step

```sh
docker compose run -it --rm api pnpm dev "what is the latest news from Jina AI?"
```

### Example: 3-step

```sh
docker compose run -it --rm api pnpm dev "what is the twitter account of jina ai's founder"
```

### Example: 13-step, ambiguious question (no def of "big")

```sh
docker compose run -it --rm api pnpm dev "who is bigger? cohere, jina ai, voyage?"
```

### Example: open question, research-like, long chain of thoughts

```sh
docker compose run -it --rm api pnpm dev "who will be president of US in 2028?"
docker compose run -it --rm api pnpm dev "what should be jina ai strategy for 2025?"
```

## Web Server API

Start the server:

```bash
docker compose run -it --rm api pnpm serve
```

The server will start on http://localhost:3000 with the following endpoints:

### POST /api/v1/query
Submit a query to be answered:
```bash
curl -X POST http://localhost:3000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "q": "what is the capital of France?",
    "budget": 1000000,
    "maxBadAttempt": 3
  }'
```

Response:
```json
{
  "requestId": "1234567890"
}
```

### GET /api/v1/stream/:requestId
Connect to the Server-Sent Events stream to receive progress updates and the final answer:
```bash
curl -N http://localhost:3000/api/v1/stream/1234567890
```

The server will emit the following event types:
- Progress updates: Step number and budget usage
- Final answer with complete response data
- Error messages if something goes wrong

Example events:

```sh
data: {"type":"progress","trackers":{"tokenUsage":74950,"tokenBreakdown":{"agent":64631,"read":10319},"actionState":{"action":"search","thoughts":"The provided text mentions several investors in Jina AI but doesn't specify ownership percentages.  A direct search for ownership percentages is needed to answer the question definitively.","URLTargets":[],"answer":"","questionsToAnswer":[],"references":[],"searchQuery":"Jina AI investor ownership percentages"},"step":7,"badAttempts":0,"gaps":[]}}

data: {"type":"progress","trackers":{"tokenUsage":74950,"tokenBreakdown":{"agent":64631,"read":10319},"actionState":{"action":"search","thoughts":"The provided text mentions several investors in Jina AI's funding rounds but doesn't specify ownership percentages.  A search focusing on equity stakes and ownership percentages held by each investor will provide the necessary information to answer the main question.","URLTargets":[],"answer":"","questionsToAnswer":[],"references":[],"searchQuery":"Jina AI investor equity percentage ownership stake"},"step":8,"badAttempts":0,"gaps":[]}}

data: {"type":"progress","trackers":{"tokenUsage":88096,"tokenBreakdown":{"agent":77777,"read":10319},"actionState":{"action":"search","thoughts":"The provided text mentions several investors in Jina AI's funding rounds but doesn't specify ownership percentages.  A search focusing on equity stakes and ownership percentages held by each investor will provide the necessary information to answer the main question.","URLTargets":[],"answer":"","questionsToAnswer":[],"references":[],"searchQuery":"Jina AI investor equity percentage ownership stake"},"step":8,"badAttempts":0,"gaps":[]}}
```

## How Does it Work?

Not sure a flowchart helps, but here it is:

```mermaid
flowchart TD
    Start([Start]) --> Init[Initialize context & variables]
    Init --> CheckBudget{Token budget<br/>exceeded?}
    CheckBudget -->|No| GetQuestion[Get current question<br/>from gaps]
    CheckBudget -->|Yes| BeastMode[Enter Beast Mode]

    GetQuestion --> GenPrompt[Generate prompt]
    GenPrompt --> ModelGen[Generate response<br/>using Gemini]
    ModelGen --> ActionCheck{Check action<br/>type}

    ActionCheck -->|answer| AnswerCheck{Is original<br/>question?}
    AnswerCheck -->|Yes| EvalAnswer[Evaluate answer]
    EvalAnswer --> IsGoodAnswer{Is answer<br/>definitive?}
    IsGoodAnswer -->|Yes| HasRefs{Has<br/>references?}
    HasRefs -->|Yes| End([End])
    HasRefs -->|No| GetQuestion
    IsGoodAnswer -->|No| StoreBad[Store bad attempt<br/>Reset context]
    StoreBad --> GetQuestion

    AnswerCheck -->|No| StoreKnowledge[Store as intermediate<br/>knowledge]
    StoreKnowledge --> GetQuestion

    ActionCheck -->|reflect| ProcessQuestions[Process new<br/>sub-questions]
    ProcessQuestions --> DedupQuestions{New unique<br/>questions?}
    DedupQuestions -->|Yes| AddGaps[Add to gaps queue]
    DedupQuestions -->|No| DisableReflect[Disable reflect<br/>for next step]
    AddGaps --> GetQuestion
    DisableReflect --> GetQuestion

    ActionCheck -->|search| SearchQuery[Execute search]
    SearchQuery --> NewURLs{New URLs<br/>found?}
    NewURLs -->|Yes| StoreURLs[Store URLs for<br/>future visits]
    NewURLs -->|No| DisableSearch[Disable search<br/>for next step]
    StoreURLs --> GetQuestion
    DisableSearch --> GetQuestion

    ActionCheck -->|visit| VisitURLs[Visit URLs]
    VisitURLs --> NewContent{New content<br/>found?}
    NewContent -->|Yes| StoreContent[Store content as<br/>knowledge]
    NewContent -->|No| DisableVisit[Disable visit<br/>for next step]
    StoreContent --> GetQuestion
    DisableVisit --> GetQuestion

    BeastMode --> FinalAnswer[Generate final answer] --> End
```

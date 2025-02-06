# DeepResearch

Keep searching, reading webpages, reasoning until it finds the answer (or exceeding the token budget).

```mermaid
---
config:
  theme: mc
  look: handDrawn
---
flowchart LR
 subgraph Loop["until budget exceed"]
    direction LR
        Search["Search"]
        Read["Read"]
        Reason["Reason"]
  end
    Query(["Query"]) --> Loop
    Search --> Read
    Read --> Reason
    Reason --> Search
    Loop --> Answer(["Answer"])

```

## Install

```bash
git clone https://github.com/jina-ai/node-DeepResearch.git
cd node-DeepResearch
npm install
```


## Usage

We use Gemini/OpenAI for reasoning, [Jina Reader](https://jina.ai/reader) for searching and reading webpages, you can get a free API key with 1M tokens from jina.ai. 

```bash
export GEMINI_API_KEY=...  # for gemini
# export OPENAI_API_KEY=... # for openai
# export LLM_PROVIDER=openai # for openai
export JINA_API_KEY=jina_...  # free jina api key, get from https://jina.ai/reader

npm run dev $QUERY
```

## Demo
Query: `"what is the latest blog post's title from jina ai?"`
3 steps; answer is correct!
![demo1](demo.gif)

Query: `"what is the context length of readerlm-v2?"`
2 steps; answer is correct!
![demo1](demo3.gif)

Query: `"list all employees from jina ai that u can find, as many as possible"` 
11 steps; partially correct! but im not in the list :(
![demo1](demo2.gif)

Query: `"who will be the biggest competitor of Jina AI"` 
42 steps; future prediction kind, so it's arguably correct! atm Im not seeing `weaviate` as a competitor, but im open for the future "i told you so" moment.
![demo1](demo4.gif)

More examples:

```
# example: no tool calling 
npm run dev "1+1="
npm run dev "what is the capital of France?"

# example: 2-step
npm run dev "what is the latest news from Jina AI?"

# example: 3-step
npm run dev "what is the twitter account of jina ai's founder"

# example: 13-step, ambiguious question (no def of "big")
npm run dev "who is bigger? cohere, jina ai, voyage?"

# example: open question, research-like, long chain of thoughts
npm run dev "who will be president of US in 2028?"
npm run dev "what should be jina ai strategy for 2025?"
```

## Web Server API

Start the server:
```bash
npm run serve
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
```
data: {"type":"progress","trackers":{"tokenUsage":74950,"tokenBreakdown":{"agent":64631,"read":10319},"actionState":{"action":"search","think":"The provided text mentions several investors in Jina AI but doesn't specify ownership percentages.  A direct search for ownership percentages is needed to answer the question definitively.","URLTargets":[],"answer":"","questionsToAnswer":[],"references":[],"searchQuery":"Jina AI investor ownership percentages"},"step":7,"badAttempts":0,"gaps":[]}}

data: {"type":"progress","trackers":{"tokenUsage":74950,"tokenBreakdown":{"agent":64631,"read":10319},"actionState":{"action":"search","think":"The provided text mentions several investors in Jina AI's funding rounds but doesn't specify ownership percentages.  A search focusing on equity stakes and ownership percentages held by each investor will provide the necessary information to answer the main question.","URLTargets":[],"answer":"","questionsToAnswer":[],"references":[],"searchQuery":"Jina AI investor equity percentage ownership stake"},"step":8,"badAttempts":0,"gaps":[]}}

data: {"type":"progress","trackers":{"tokenUsage":88096,"tokenBreakdown":{"agent":77777,"read":10319},"actionState":{"action":"search","think":"The provided text mentions several investors in Jina AI's funding rounds but doesn't specify ownership percentages.  A search focusing on equity stakes and ownership percentages held by each investor will provide the necessary information to answer the main question.","URLTargets":[],"answer":"","questionsToAnswer":[],"references":[],"searchQuery":"Jina AI investor equity percentage ownership stake"},"step":8,"badAttempts":0,"gaps":[]}}
```

## Docker

### Build Docker Image
To build the Docker image for the application, run the following command:
```bash
docker build -t deepresearch:latest .
```

### Run Docker Container
To run the Docker container, use the following command:
```bash
docker run -p 3000:3000 --env GEMINI_API_KEY=your_gemini_api_key --env JINA_API_KEY=your_jina_api_key --env BRAVE_API_KEY=your_brave_api_key deepresearch:latest
```

### Docker Compose
You can also use Docker Compose to manage multi-container applications. To start the application with Docker Compose, run:
```bash
docker-compose up
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

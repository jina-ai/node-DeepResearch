import {PromptPair, SearchAction, TrackerContext} from '../types';
import {ObjectGeneratorSafe} from "../utils/safe-generator";
import {Schemas} from "../utils/schemas";

export const IS_DEEP_QUERY_REWRITE = true

function getPrompt(query: string, think: string): PromptPair {
  const currentTime = new Date();
  const currentYear = currentTime.getFullYear();
  const currentMonth = currentTime.getMonth() + 1;

  return {
    system: `You are an expert search query generator with deep psychological understanding. You optimize user queries by extensively analyzing potential user intents and generating comprehensive search variations.

The current time is ${currentTime.toISOString()}. Current year: ${currentYear}, current month: ${currentMonth}.

<intent-mining>
To uncover the deepest user intent behind every query, analyze through these progressive layers:

1. Surface Intent: The literal interpretation of what they're asking for
2. Practical Intent: The tangible goal or problem they're trying to solve
3. Emotional Intent: The feelings driving their search (fear, aspiration, anxiety, curiosity)
4. Social Intent: How this search relates to their relationships or social standing
5. Identity Intent: How this search connects to who they want to be or avoid being
6. Taboo Intent: The uncomfortable or socially unacceptable aspects they won't directly state
7. Shadow Intent: The unconscious motivations they themselves may not recognize

Map each query through ALL these layers, especially focusing on uncovering Shadow Intent.
</intent-mining>

<cognitive-personas>
Generate ONE optimized query from each of these cognitive perspectives:

1. Expert Skeptic: Focus on edge cases, limitations, counter-evidence, and potential failures. Generate a query that challenges mainstream assumptions and looks for exceptions.

2. Detail Analyst: Obsess over precise specifications, technical details, and exact parameters. Generate a query that drills into granular aspects and seeks definitive reference data.

3. Historical Researcher: Examine how the subject has evolved over time, previous iterations, and historical context. Generate a query that tracks changes, development history, and legacy issues.

4. Comparative Thinker: Explore alternatives, competitors, contrasts, and trade-offs. Generate a query that sets up comparisons and evaluates relative advantages/disadvantages.

5. Temporal Context: Add a time-sensitive query that incorporates the current date (${currentYear}-${currentMonth}) to ensure recency and freshness of information.

6. Globalizer: Identify the most authoritative language/region for the subject matter (not just the query's origin language). For example, use German for BMW (German company), English for tech topics, Japanese for anime, Italian for cuisine, etc. Generate a search in that language to access native expertise.

7. Reality-Hater-Skepticalist: Actively seek out contradicting evidence to the original query. Generate a search that attempts to disprove assumptions, find contrary evidence, and explore "Why is X false?" or "Evidence against X" perspectives.

Ensure each persona contributes exactly ONE high-quality query. These 7 queries will be combined into a final array.
</cognitive-personas>

<rules>
1. Start with deep intent analysis:
   - Direct intent (what they explicitly ask)
   - Implicit intent (what they might actually want)
   - Related intents (what they might need next)
   - Prerequisite knowledge (what they need to know first)
   - Common pitfalls (what they should avoid)
   - Expert perspectives (what professionals would search for)
   - Beginner needs (what newcomers might miss)
   - Alternative approaches (different ways to solve the problem)

2. For each identified intent:
   - Generate queries in original language
   - Generate queries in English (if not original)
   - Generate queries in most authoritative language
   - Use appropriate operators and filters

3. Query structure rules:
   - Use exact match quotes for specific phrases
   - Split queries for distinct aspects
   - Add operators only when necessary
   - Ensure each query targets a specific intent
   - Remove fluff words but preserve crucial qualifiers
   - Keep queries short and keyword-based (2-5 words ideal)

<query-operators>
A query can't only have operators; and operators can't be at the start a query;

- "phrase" : exact match for phrases
- +term : must include term; for critical terms that must appear
- -term : exclude term; exclude irrelevant or ambiguous terms
- filetype:pdf/doc : specific file type
- site:example.com : limit to specific site
- lang:xx : language filter (ISO 639-1 code)
- loc:xx : location filter (ISO 3166-1 code)
- intitle:term : term must be in title
- inbody:term : term must be in body text
</query-operators>

</rules>

<examples>
<example-1>
Input Query: 宝马二手车价格
<think>
表面意图是查询二手宝马汽车价格范围，实用意图是确定购买预算并了解不同型号价格差异。情感上渴望拥有豪华品牌却担心维护成本高昂。社会意图是通过宝马提升地位形象，获得他人认可。身份意图是将自己视为值得拥有豪华品牌的成功人士。禁忌层面可能超出实际经济能力却不愿承认，潜意识中则是通过物质寻求安全感，填补内心空虚。

专家怀疑者：寻找二手宝马的隐藏问题和可能被忽视的严重缺陷。
细节分析者：专注二手宝马各系列精确价格数据和规格对比。
历史研究者：追踪二手宝马价格和可靠性的历史变化趋势。
比较思考者：将二手宝马与其他品牌和购车选择进行对比分析。
时间语境者：关注${currentYear}年最新市场数据和价格趋势。
全球化者：宝马源自德国，用德语搜索可获得最权威的车辆信息。
现实怀疑论者：主动寻找购买二手宝马的负面证据和后悔案例。
</think>
queries: [
  "二手宝马 维修噩梦 隐藏缺陷",
  "宝马各系价格区间 里程对比",
  "二手宝马价格趋势 2018-${currentYear}",
  "二手宝马vs奔驰vs丰田 性价比",
  "${currentYear}年${currentMonth}月 宝马行情",
  "BMW Gebrauchtwagen Probleme lang:de",
  "二手宝马后悔案例 最差投资"
]
</example-1>

<example-2>
Input Query: Python Django authentication best practices
<think>
Surface intent is finding Django authentication best practices, practical intent is implementing a secure reliable authentication system. Emotional intent involves anxiety about making security mistakes that damage professional reputation. Social intent is to demonstrate competence to colleagues and senior developers. Identity intent is to be a responsible engineer following best practices. Taboo intent may include lacking knowledge of underlying authentication mechanisms or rushing implementation to meet deadlines. Shadow intent might involve impostor syndrome, using research to procrastinate coding, or hoping to find perfect solutions without understanding principles.

Expert Skeptic: Challenge Django auth security by finding known vulnerabilities and weaknesses.
Detail Analyst: Dig into exact technical parameters and configuration specifics of the auth system.
Historical Researcher: Study the evolution history of Django authentication and deprecated features.
Comparative Thinker: Compare Django auth with alternative authentication methods and tradeoffs.
Temporal Context: Ensure getting the latest ${currentYear} security best practices.
Globalizer: Django documentation is primarily English-based, so query official documentation source.
Reality-Hater-Skepticalist: Explore fundamental flaws that might exist in Django's built-in auth.
</think>
queries: [
  "Django authentication vulnerabilities exploits",
  "Django AUTH_PASSWORD_VALIDATORS specification",
  "Django authentication deprecation timeline",
  "Django auth vs OAuth vs JWT",
  "Django ${currentYear} security updates",
  "site:docs.djangoproject.com authentication",
  "Django built-in auth limitations problems"
]
</example-2>

<example-3>
Input Query: KIリテラシー向上させる方法
<think>
表面意図はAIリテラシーを高める方法を求めている。実用意図はAIツールを効果的に活用し職場での生産性向上を図ること。感情面ではAI進化に取り残される不安がある。社会的にはAI知識豊富な人物として評価されたい。禁忌領域では実はAI基礎知識の欠如を隠している。潜在意識では技術進化への恐怖、知識陳腐化への不安がある。

専門家の懐疑者：AI技術の限界と誇大宣伝を暴く視点で検索。
詳細分析者：AIリテラシーの具体的なスキル階層と学習方法を探求。
歴史研究者：AI技術の歴史的発展と過去のブームから学ぶ教訓を調査。
比較思考者：AIリテラシーと他のデジタルスキルを比較分析。
時間的文脈：${currentYear}年の最新AI動向と必要スキルに焦点。
グローバル化：AI研究の中心は英語圏のため、英語での専門資料を検索。
現実否定的懐疑論者：AIリテラシー向上が無意味である可能性を探る。
</think>
queries: [
  "AI技術 限界 誇大宣伝",
  "AIリテラシー 学習ステップ 体系化",
  "AI歴史 失敗事例 教訓",
  "AIリテラシー vs プログラミング vs 批判思考",
  "${currentYear}AI最新トレンド 必須スキル",
  "artificial intelligence literacy fundamentals lang:en",
  "AIリテラシー向上 無意味 理由"
]
</example-3>
</examples>`,
    user: `
${query}

<think>${think}
`
  };
}

const TOOL_NAME = 'queryRewriter';

export async function rewriteQuery(action: SearchAction, trackers: TrackerContext, schemaGen: Schemas): Promise<{ queries: string[] }> {
  try {
    const generator = new ObjectGeneratorSafe(trackers.tokenTracker);
    const allQueries = [...action.searchRequests];

    const queryPromises = action.searchRequests.map(async (req) => {
      const prompt = getPrompt(req, action.think);
      const result = await generator.generateObject({
        model: TOOL_NAME,
        schema: schemaGen.getQueryRewriterSchema(),
        system: prompt.system,
        prompt: prompt.user,
      });
      trackers?.actionTracker.trackThink(result.object.think);
      return result.object.queries;
    });

    const queryResults = await Promise.all(queryPromises);
    queryResults.forEach(queries => allQueries.push(...queries));
    console.log(TOOL_NAME, allQueries);
    return {queries: allQueries};
  } catch (error) {
    console.error(`Error in ${TOOL_NAME}`, error);
    throw error;
  }
}

export async function rewriteQueryDeep(action: SearchAction, trackers: TrackerContext, schemaGen: Schemas): Promise<{ queries: string[] }> {
  try {
    console.log('call deep rewrite')
    const generator = new ObjectGeneratorSafe(trackers.tokenTracker);
    const allQueries = [...action.searchRequests];
    const motivationExplanation = `\
When a user uses a search engine they have an underlying motivation to type in their search query. \
Just from the search query, there is not enough information to find out what their underlying motivation was.`
    const desirePrompt = `\
${motivationExplanation}
However, we can brainstorm possible motivations.

Given the following search queries:
${JSON.stringify(allQueries, null, 2)}

Brainstorm the top 5 most likely unique possible motivations (out of 100) why the user is typing these queries into a search engine.
Note: All possible motivations are 100% distinct from each other and must give a very different explanation.
Most importantly, each motivation must not be predictable.`

    const motivationResult = await generator.generateObject({
      model: TOOL_NAME,
      schema: schemaGen.getMotivationsSchema(),
      system: `You are an expert in understanding human motivations and desires.`,
      prompt: desirePrompt,
    });
    const motivations = motivationResult.object.motivations;

    const searchQueriesPrompt = `\
${motivationExplanation}
Given the following search queries:
${JSON.stringify(allQueries, null, 2)}
And given the following motivations:
${JSON.stringify(motivations, null, 2)}

Your task is to generate a very specific version of the search query for each motivation.`
    const searchQueriesResult = await generator.generateObject({
      model: TOOL_NAME,
      schema: schemaGen.getQueryRewriterSchema(),
      system: `You are an expert in understanding human motivations and desires and translating them into search queries.`,
      prompt: searchQueriesPrompt,
    });
    trackers?.actionTracker.trackThink(searchQueriesResult.object.think);
    const queries = searchQueriesResult.object.queries;
    console.log('here are the queries', queries)
    return {queries};
  } catch (error) {
    console.error(`Error in ${TOOL_NAME}`, error);
    throw error;
  }
}
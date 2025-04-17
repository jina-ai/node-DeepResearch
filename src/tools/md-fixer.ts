import {KnowledgeItem, PromptPair, TrackerContext} from '../types';
import {getKnowledgeStr} from "../utils/text-tools";
import {getModel} from "../config";
import {generateText} from "ai";
import {Schemas} from "../utils/schemas";


function getPrompt(mdContent: string, allKnowledge: KnowledgeItem[], schema: Schemas): PromptPair {
  const KnowledgeStr = getKnowledgeStr(allKnowledge);


  return {
    system: `You are a senior editor with multiple best-selling books and columns published in top magazines. You break conventional thinking, establish unique cross-disciplinary connections, and bring new perspectives to the user.

Your task is to revise the provided markdown content (written by your junior intern) while preserving its original vibe, structure, delivering a polished and professional version.

<structure>
- Begin with a blunt, fact-driven, and unapologetically statement of the main question or issue you'll address
- Develop your argument using a logical progression of ideas while allowing for occasional contemplative digressions that enrich the reader's understanding
- Organize paragraphs with clear topic sentences but vary paragraph length to create rhythm and emphasis
- Present facts, quotes and data points with minimal hedging
- Conclude with both a definitive statement of your position and a thought-provoking reflection that leaves readers pondering deeper implications and insane hot-takes.
</structure>

<language-style>
- Balance factual precision with vivid, evocative descriptions
- Incorporate humor and wit to illuminate serious intellectual points
- Use accessible language that combines clarity with elegant expressiveness
- Include relevant cultural references from both Eastern and Western traditions while maintaining analytical rigor
- Brutal intellectual honesty that doesn't pander to feelings
</language-style>

<content-approach>
- Address a contemporary issue through both rational analysis and humanistic reflection
- Support arguments with empirical evidence alongside illustrative anecdotes and metaphors
- Consider practical implications while exploring philosophical dimensions
- Maintain intellectual honesty and critical thinking with an appreciation for life's paradoxes and ironies
- Dismiss regulatory barriers and status quo defenders as obstacles to progress
- Present technological development as a moral imperative
</content-approach>

<rules>
1. Extend the content with 5W1H strategy and add more details to make it more informative and engaging. Use available knowledge to ground facts and fill in missing information.
2. Fix any broken tables, lists, code blocks, footnotes, or formatting issues.
3. Make sure nested lists are correctly indented, especially code blocks within the nested structure. Code block should be fenced with triple backticks, except HTML table.
4. Tables are good! But they must always in basic HTML table syntax with proper <table> <thead> <tr> <th> <td> without any CSS styling. STRICTLY AVOID any markdown table syntax. HTML Table should NEVER BE fenced with (\`\`\`html) triple backticks.
5. Avoid over-using bullet points by elaborate deeply nested structure into natural language sections/paragraphs to make the content more readable. 
6. Replace any obvious placeholders or Lorem Ipsum values such as "example.com" with the actual content derived from the knowledge.
7. Conclusion section if exists should provide deep, unexpected insights, identifying hidden patterns and connections, and creating "aha moments.".
8. Your output language must be the same as user input language.
</rules>


The following knowledge items are provided for your reference. Note that some of them may not be directly related to the content user provided, but may give some subtle hints and insights:
${KnowledgeStr.join('\n\n')}

IMPORTANT: Do not begin your response with phrases like "Sure", "Here is", "Below is", or any other introduction. Directly output your revised content in ${schema.languageStyle} that is ready to be published. Preserving HTML tables if exist, never use tripple backticks html to wrap html table.`,
    user: mdContent
  }
}

const TOOL_NAME = 'md-fixer';

export async function reviseAnswer(
  mdContent: string,
  knowledgeItems: KnowledgeItem[],
  trackers: TrackerContext,
  schema: Schemas
): Promise<string> {
  try {
    const prompt = getPrompt(mdContent, knowledgeItems, schema);
    trackers?.actionTracker.trackThink('final_answer', schema.languageCode)

    const result = await generateText({
      model: getModel('agent'),
      system: prompt.system,
      prompt: prompt.user,
    });

    trackers.tokenTracker.trackUsage('md-fixer', result.usage)


    console.log(TOOL_NAME, result.text);
    console.log('repaired before/after', mdContent.length, result.text.length);

    if (result.text.length < mdContent.length * 0.85) {
      console.error(`repaired content length ${result.text.length} is significantly shorter than original content ${mdContent.length}, return original content instead.`);
      return mdContent;
    }

    return result.text;

  } catch (error) {
    console.error(`Error in ${TOOL_NAME}`, error);
    return mdContent;
  }
}
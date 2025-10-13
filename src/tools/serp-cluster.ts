import { PromptPair, TrackerContext } from '../types';
import { ObjectGeneratorSafe } from "../utils/safe-generator";
import { Schemas } from "../utils/schemas";
import { logInfo, logError } from '../logging';
import { SearchSnippet } from '../types';

function getPrompt(results: SearchSnippet[]): PromptPair {
  return {
    system: `
You are a search engine result analyzer. You look at the SERP API response and group them into meaningful cluster. 

Each cluster should contain a summary of the content, key data and insights, the corresponding URLs and search advice.
`,
    user:
      `
${JSON.stringify(results)}
`
  };
}
const TOOL_NAME = 'serpCluster';

export async function serpCluster(results: SearchSnippet[], trackers: TrackerContext, schemaGen: Schemas): Promise<any[]> {
  try {
    const generator = new ObjectGeneratorSafe(trackers.tokenTracker);
    const prompt = getPrompt(results);
    const result = await generator.generateObject({
      model: TOOL_NAME,
      schema: schemaGen.getSerpClusterSchema(),
      system: prompt.system,
      prompt: prompt.user,
    });
    trackers?.actionTracker.trackThink(result.object.think);
    const clusters = result.object.clusters;
    logInfo(TOOL_NAME, { clusters });
    return clusters;
  } catch (error) {
    logError(TOOL_NAME, { error });
    throw error;
  }
}
import { generateText } from "ai";
import { getModel } from "../config";
import {TrackerContext} from "../types";
import {detectBrokenUnicodeViaFileIO} from "../utils/text-tools";


/**
 * Repairs markdown content with � characters by using Gemini to guess the missing text
 */
export async function repairUnknownChars(mdContent: string, trackers?: TrackerContext): Promise<string> {
  const { broken, readStr } = await detectBrokenUnicodeViaFileIO(mdContent);
  if (!broken) return readStr;
  console.log("Detected broken unicode in output, attempting to repair...");

  let repairedContent = readStr;
  let remainingUnknowns = true;
  let iterations = 0;

  let lastPosition = -1;

  while (remainingUnknowns && iterations < 20) {
    iterations++;

    // Find the position of the first � character
    const position = repairedContent.indexOf('�');
    if (position === -1) {
      remainingUnknowns = false;
      continue;
    }

    // Check if we're stuck at the same position
    if (position === lastPosition) {
      // Move past this character by removing it
      repairedContent = repairedContent.substring(0, position) +
                         repairedContent.substring(position + 1);
      continue;
    }

    // Update last position to detect loops
    lastPosition = position;

    // Count consecutive � characters
    let unknownCount = 0;
    for (let i = position; i < repairedContent.length && repairedContent[i] === '�'; i++) {
      unknownCount++;
    }

    // Extract context around the unknown characters
    const contextSize = 50;
    const start = Math.max(0, position - contextSize);
    const end = Math.min(repairedContent.length, position + unknownCount + contextSize);
    const leftContext = repairedContent.substring(start, position);
    const rightContext = repairedContent.substring(position + unknownCount, end);

    // Ask Gemini to guess the missing characters
    try {
      const result = await generateText({
        model: getModel('fallback'),
        system: `You're helping fix a corrupted scanned markdown document that has stains (represented by �). 
Looking at the surrounding context, determine the original text should be in place of the � symbols.

Rules:
1. ONLY output the exact replacement text - no explanations, quotes, or additional text
2. Keep your response appropriate to the length of the unknown sequence
3. Consider the document appears to be in Chinese if that's what the context suggests`,
        prompt: `
The corrupted text has ${unknownCount} � mush in a row.

On the left of the stains: "${leftContext}"
On the right of the stains: "${rightContext}"

So what was the original text between these two contexts?`,
      });

      trackers?.tokenTracker.trackUsage('md-fixer', result.usage)
      const replacement = result.text.trim();

      // Validate the replacement
      if (
        replacement === "UNKNOWN" ||
        (await detectBrokenUnicodeViaFileIO(replacement)).broken ||
        replacement.length > unknownCount * 4
      ) {
        console.log(`Skipping invalid replacement ${replacement} at position ${position}`);
        // Skip to the next � character without modifying content
      } else {
        // Replace the unknown sequence with the generated text
        repairedContent = repairedContent.substring(0, position) +
                         replacement +
                         repairedContent.substring(position + unknownCount);
      }

      console.log(`Repair iteration ${iterations}: replaced ${unknownCount} � chars with "${replacement}"`);

    } catch (error) {
      console.error("Error repairing unknown characters:", error);
      // Skip to the next � character without modifying this one
    }
  }

  return repairedContent;
}
import {AnswerAction, KnowledgeItem, Reference} from "../types";
import i18nJSON from './i18n.json';
import {JSDOM} from 'jsdom';
import fs from "fs/promises";


export function buildMdFromAnswer(answer: AnswerAction): string {
  return repairMarkdownFootnotes(answer.answer, answer.references);
}

export function repairMarkdownFootnotes(
  markdownString: string,
  references?: Array<Reference>
): string {
  // Standard footnote regex - handles [^1], [1^], and [1] formats
  const footnoteRegex = /\[(\^(\d+)|(\d+)\^|(\d+))]/g;

  // Regex to catch grouped footnotes like [^1, ^2, ^3] or [^1,^2,^3]
  const groupedFootnoteRegex = /\[\^(\d+)(?:,\s*\^(\d+))+]/g;

  // New regex to catch partially marked footnotes like [^10, 11]
  const partialGroupedFootnoteRegex = /\[\^(\d+)(?:,\s*(\d+))+]/g;

  // Helper function to format references
  const formatReferences = (refs: Array<Reference>) => {
    return refs.map((ref, i) => {
      const cleanQuote = ref.exactQuote
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ').trim();

      const citation = `[^${i + 1}]: ${cleanQuote}`;

      if (!ref.url) return citation;

      const domainName = new URL(ref.url).hostname.replace('www.', '');
      return `${citation} [${ref.title || domainName}](${ref.url})`;
    }).join('\n\n');
  };

  // First case: no references - remove any footnote citations
  if (!references?.length) {
    return markdownString
      .replace(partialGroupedFootnoteRegex, (match) => {
        // Extract all numbers from the partially marked grouped footnote
        const numbers = match.match(/\d+/g) || [];
        return numbers.map(num => `[^${num}]`).join(', ');
      })
      .replace(groupedFootnoteRegex, (match) => {
        // Extract all numbers from the grouped footnote
        const numbers = match.match(/\d+/g) || [];
        return numbers.map(num => `[^${num}]`).join(', ');
      })
      .replace(footnoteRegex, '');
  }

  // Normalize footnotes first (convert [1^] to [^1] format and [1] to [^1] format)
  let processedMarkdown = markdownString
    .replace(/\[(\d+)\^]/g, (_, num) => `[^${num}]`)
    .replace(/\[(\d+)]/g, (_, num) => `[^${num}]`);

  // Fix grouped footnotes - both fully marked and partially marked types
  processedMarkdown = processedMarkdown
    .replace(groupedFootnoteRegex, (match) => {
      const numbers = match.match(/\d+/g) || [];
      return numbers.map(num => `[^${num}]`).join(', ');
    })
    .replace(partialGroupedFootnoteRegex, (match) => {
      const numbers = match.match(/\d+/g) || [];
      return numbers.map(num => `[^${num}]`).join(', ');
    });

  // Now extract all footnotes from the processed answer
  const footnotes: string[] = [];
  let match;
  const standardFootnoteRegex = /\[\^(\d+)]/g; // Use standard format after normalization
  while ((match = standardFootnoteRegex.exec(processedMarkdown)) !== null) {
    footnotes.push(match[1]);
  }

  // Remove footnote markers that don't have corresponding references
  let cleanedMarkdown = processedMarkdown;
  footnotes.forEach(footnote => {
    const footnoteNumber = parseInt(footnote);
    if (footnoteNumber > references.length) {
      const footnoteRegexExact = new RegExp(`\\[\\^${footnoteNumber}\\]`, 'g');
      cleanedMarkdown = cleanedMarkdown.replace(footnoteRegexExact, '');
    }
  });

  // Get valid footnotes after cleaning
  const validFootnotes: string[] = [];
  while ((match = standardFootnoteRegex.exec(cleanedMarkdown)) !== null) {
    validFootnotes.push(match[1]);
  }

  // No footnotes in answer but we have references - append them at the end
  if (validFootnotes.length === 0) {
    const appendedCitations = Array.from(
      {length: references.length},
      (_, i) => `[^${i + 1}]`
    ).join('');

    const formattedReferences = formatReferences(references);

    return `
${cleanedMarkdown}

⁜${appendedCitations}

${formattedReferences}
`.trim();
  }

  // Check if correction is needed
  const needsCorrection =
    (validFootnotes.length === references.length && validFootnotes.every(n => n === validFootnotes[0])) ||
    (validFootnotes.every(n => n === validFootnotes[0]) && parseInt(validFootnotes[0]) > references.length) ||
    (validFootnotes.length > 0 && validFootnotes.every(n => parseInt(n) > references.length));

  // New case: we have more references than footnotes
  if (references.length > validFootnotes.length && !needsCorrection) {
    // Get the used indices
    const usedIndices = new Set(validFootnotes.map(n => parseInt(n)));

    // Create citations for unused references
    const unusedReferences = Array.from(
      {length: references.length},
      (_, i) => !usedIndices.has(i + 1) ? `[^${i + 1}]` : ''
    ).join('');

    return `
${cleanedMarkdown} 

⁜${unusedReferences}

${formatReferences(references)}
`.trim();
  }

  if (!needsCorrection) {
    return `
${cleanedMarkdown}

${formatReferences(references)}
`.trim();
  }

  // Apply correction: sequentially number the footnotes
  let currentIndex = 0;
  const correctedMarkdown = cleanedMarkdown.replace(standardFootnoteRegex, () =>
    `[^${++currentIndex}]`
  );

  return `
${correctedMarkdown}

${formatReferences(references)}
`.trim();
}

/**
 * A variant of the function that only takes a markdown string
 * It extracts existing footnote definitions and uses them as references
 */
export function repairMarkdownFootnotesOuter(markdownString: string): string {
  // First trim the string to handle any extra whitespace
  markdownString = markdownString.trim();

  // Unwrap ALL code fences throughout the document
  // This matches any content between ```markdown or ```html and closing ```
  const codeBlockRegex = /```(markdown|html)\n([\s\S]*?)\n```/g;
  let match;
  let processedString = markdownString;

  while ((match = codeBlockRegex.exec(markdownString)) !== null) {
    const entireMatch = match[0];
    const codeContent = match[2];
    processedString = processedString.replace(entireMatch, codeContent);
  }

  markdownString = processedString;

  // Extract existing footnote definitions
  const footnoteDefRegex = /\[\^(\d+)]:\s*(.*?)(?=\n\[\^|$)/gs;
  const references: Array<Reference> = [];

  // Extract content part (without footnote definitions)
  let contentPart = markdownString;
  let footnotesPart = '';

  // Try to find where footnote definitions start
  const firstFootnoteMatch = markdownString.match(/\[\^(\d+)]:/);
  if (firstFootnoteMatch) {
    const footnoteStartIndex = firstFootnoteMatch.index;
    if (footnoteStartIndex !== undefined) {
      contentPart = markdownString.substring(0, footnoteStartIndex);
      footnotesPart = markdownString.substring(footnoteStartIndex);
    }
  }

  // Extract all footnote definitions
  let footnoteMatch;
  while ((footnoteMatch = footnoteDefRegex.exec(footnotesPart)) !== null) {
    // The footnote content
    let content = footnoteMatch[2].trim();

    // Extract URL and title if present
    // Looking for [domain.com](url) pattern at the end of the content
    const urlMatch = content.match(/\s*\[([^\]]+)]\(([^)]+)\)\s*$/);

    let url = '';
    let title = '';

    if (urlMatch) {
      // Extract the domain name as title
      title = urlMatch[1];
      // Extract the URL
      url = urlMatch[2];

      // Remove the URL part from the content to get clean exactQuote
      content = content.replace(urlMatch[0], '').trim();
    }

    // Add to references array
    references.push({
      exactQuote: content,
      url,
      title
    });
  }

  // Only process if we found valid references
  if (references.length > 0) {
    return repairMarkdownFootnotes(contentPart, references);
  }

  // Otherwise, return original markdown unchanged
  return markdownString;
}

export const removeExtraLineBreaks = (text: string) => {
  return text.replace(/\n{2,}/gm, '\n\n');
}

export function chooseK(a: string[], k: number) {
  // randomly sample k from `a` without repitition
  return a.sort(() => 0.5 - Math.random()).slice(0, k);
}

export function removeHTMLtags(text: string) {
  return text.replace(/<[^>]*>?/gm, '');
}

export function removeAllLineBreaks(text: string) {
  return text.replace(/(\r\n|\n|\r)/gm, " ");
}

export function getI18nText(key: string, lang = 'en', params: Record<string, string> = {}) {
  // 获取i18n数据
  const i18nData = i18nJSON as Record<string, any>;
  // 确保语言代码存在，如果不存在则使用英语作为后备
  if (!i18nData[lang]) {
    console.error(`Language '${lang}' not found, falling back to English.`);
    lang = 'en';
  }

  // 获取对应语言的文本
  let text = i18nData[lang][key];

  // 如果文本不存在，则使用英语作为后备
  if (!text) {
    console.error(`Key '${key}' not found for language '${lang}', falling back to English.`);
    text = i18nData['en'][key];

    // 如果英语版本也不存在，则返回键名
    if (!text) {
      console.error(`Key '${key}' not found for English either.`);
      return key;
    }
  }

  // 替换模板中的变量
  if (params) {
    Object.keys(params).forEach(paramKey => {
      text = text.replace(`\${${paramKey}}`, params[paramKey]);
    });
  }

  return text;
}

export function smartMergeStrings(str1: string, str2: string): string {
  // If either string is empty, return the other
  if (!str1) return str2;
  if (!str2) return str1;

  // Check if one string is entirely contained within the other
  if (str1.includes(str2)) return str1;
  if (str2.includes(str1)) return str2;

  // Find the maximum possible overlap length
  const maxOverlap = Math.min(str1.length, str2.length);
  let bestOverlapLength = 0;

  // Check for overlaps starting from the largest possible
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength--) {
    // Get the end of first string with the current overlap length
    const endOfStr1 = str1.slice(str1.length - overlapLength);
    // Get the beginning of second string with the current overlap length
    const startOfStr2 = str2.slice(0, overlapLength);

    // If they match, we've found our overlap
    if (endOfStr1 === startOfStr2) {
      bestOverlapLength = overlapLength;
      break;
    }
  }

  // Merge the strings using the best overlap
  if (bestOverlapLength > 0) {
    return str1.slice(0, str1.length - bestOverlapLength) + str2;
  } else {
    // No overlap found, concatenate normally
    return str1 + str2;
  }
}


export function fixCodeBlockIndentation(markdownText: string): string {
  // Track the state of code blocks and their indentation
  const lines = markdownText.split('\n');
  const result: string[] = [];

  // Track open code blocks and their indentation
  const codeBlockStack: { indent: string; language: string; listIndent: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if the line potentially contains a code fence marker
    if (line.trimStart().startsWith('```')) {
      const indent = line.substring(0, line.indexOf('```'));
      const restOfLine = line.trimStart().substring(3).trim();

      if (codeBlockStack.length === 0) {
        // This is an opening code fence

        // Determine if we're in a list context by looking at previous lines
        let listIndent = "";
        if (i > 0) {
          // Look back up to 3 lines to find list markers
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
            const prevLine = lines[j];
            // Check for list markers like *, -, 1., etc.
            if (/^\s*(?:[*\-+]|\d+\.)\s/.test(prevLine)) {
              // Extract the list's base indentation
              const match = prevLine.match(/^(\s*)/);
              if (match) {
                listIndent = match[1];
                break;
              }
            }
          }
        }

        codeBlockStack.push({indent, language: restOfLine, listIndent});
        result.push(line);
      } else {
        // This is a closing code fence
        const openingBlock = codeBlockStack.pop();

        if (openingBlock) {
          // Replace the indentation with the one from the opening fence
          result.push(`${openingBlock.indent}\`\`\``);
        } else {
          // Something went wrong, just keep the line as is
          result.push(line);
        }
      }
    } else if (codeBlockStack.length > 0) {
      // Inside a code block - handle indentation
      const openingBlock = codeBlockStack[codeBlockStack.length - 1];

      if (line.trim().length > 0) {
        // Calculate proper base indentation for the code block
        let baseIndent;
        if (openingBlock.listIndent) {
          // For code blocks in lists
          baseIndent = openingBlock.listIndent + "    ";
        } else {
          // Not in a list
          baseIndent = openingBlock.indent;
        }

        // Get the indentation of this specific line
        const lineIndentMatch = line.match(/^(\s*)/);
        const lineIndent = lineIndentMatch ? lineIndentMatch[0] : '';

        // Find the common prefix between the line's indent and the opening block's indent
        // This represents the part of the indentation that's due to the markdown structure
        let commonPrefix = '';
        const minLength = Math.min(lineIndent.length, openingBlock.indent.length);
        for (let i = 0; i < minLength; i++) {
          if (lineIndent[i] === openingBlock.indent[i]) {
            commonPrefix += lineIndent[i];
          } else {
            break;
          }
        }

        // Remove just the common prefix (markdown structure indentation)
        // and keep the rest (code's own indentation)
        const contentAfterCommonIndent = line.substring(commonPrefix.length);

        // Add the proper base indentation plus the preserved code indentation
        result.push(`${baseIndent}${contentAfterCommonIndent}`);
      } else {
        // For empty lines, just keep them as is
        result.push(line);
      }
    } else {
      // Not in a code block, just add it as is
      result.push(line);
    }
  }

  return result.join('\n');
}

export function getKnowledgeStr(allKnowledge: KnowledgeItem[]) {
  return allKnowledge.map((k, idx) => {
    const aMsg = `
<knowledge-${idx + 1}>
${k.question}

${k.updated && (k.type === 'url' || k.type === 'side-info') ? `
<knowledge-datetime>
${k.updated}
</knowledge-datetime>
` : ''}

${k.references && k.type === 'url' ? `
<knowledge-url>
${k.references[0]}
</knowledge-url>
` : ''}


${k.answer}
</knowledge-${idx + 1}>
      `.trim();

    return removeExtraLineBreaks(aMsg);
  })
}


/**
 * Converts HTML tables in a markdown string to markdown tables
 * @param mdString The markdown string containing potential HTML tables
 * @returns The markdown string with HTML tables converted to markdown tables, or the original string if no conversions were made
 */
export function convertHtmlTablesToMd(mdString: string): string {
  try {
    let result = mdString;

    // First check for HTML tables with any attributes
    if (mdString.includes('<table')) {
      // Regular expression to find HTML tables with any attributes
      // This matches <table> as well as <table with-any-attributes>
      const tableRegex = /<table(?:\s+[^>]*)?>([\s\S]*?)<\/table>/g;
      let match;

      // Process each table found
      while ((match = tableRegex.exec(mdString)) !== null) {
        const htmlTable = match[0];
        const convertedTable = convertSingleHtmlTableToMd(htmlTable);

        if (convertedTable) {
          result = result.replace(htmlTable, convertedTable);
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Error converting HTML tables to Markdown:', error);
    return mdString; // Return original string if conversion fails
  }
}

/**
 * Converts a single HTML table to a markdown table
 * @param htmlTable The HTML table string
 * @returns The markdown table string or null if conversion fails
 */
function convertSingleHtmlTableToMd(htmlTable: string): string | null {
  try {
    // Create a DOM parser to parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlTable, 'text/html');
    const table = doc.querySelector('table');

    if (!table) {
      return null;
    }

    // Extract headers
    const headers = Array.from(table.querySelectorAll('thead th'))
      .map(th => sanitizeCell(th.textContent || ''));

    // Check if headers were found
    if (headers.length === 0) {
      // Try to find headers in the first row of tbody
      const firstRow = table.querySelector('tbody tr');
      if (firstRow) {
        headers.push(...Array.from(firstRow.querySelectorAll('td, th'))
          .map(cell => sanitizeCell(cell.textContent || '')));
      }
    }

    if (headers.length === 0) {
      return null; // No headers found, can't create a valid markdown table
    }

    // Start building the markdown table
    let mdTable = '';

    // Add the header row
    mdTable += '| ' + headers.join(' | ') + ' |\n';

    // Add the separator row
    mdTable += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

    // Add the data rows
    const rows = Array.from(table.querySelectorAll('tbody tr'));

    for (const row of rows) {
      // Skip the first row if it was used for headers
      if (table.querySelector('thead') === null && row === rows[0]) {
        continue;
      }

      const cells = Array.from(row.querySelectorAll('td'))
        .map(td => {
          // Check for markdown content in the cell
          const cellContent = td.innerHTML;
          let processedContent = cellContent;

          // Detect if the cell contains markdown formatting
          const containsMarkdown =
            cellContent.includes('**') ||
            cellContent.includes('*   ') ||
            cellContent.includes('*  ') ||
            cellContent.includes('* ');

          if (containsMarkdown) {
            // Handle mixed HTML and Markdown

            // Handle lists inside cells (both ordered and unordered)
            if (cellContent.includes('* ') || cellContent.includes('*  ') || cellContent.includes('*   ')) {
              // Extract list items, handling both HTML list structures or markdown-style lists
              let listItems = [];

              if (td.querySelectorAll('li').length > 0) {
                // Handle HTML lists
                listItems = Array.from(td.querySelectorAll('li'))
                  .map(li => li.innerHTML.trim());
              } else {
                // Handle markdown-style lists with asterisks
                const lines = cellContent.split('\n');
                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (trimmedLine.match(/^\s*\*\s+/)) {
                    listItems.push(trimmedLine.replace(/^\s*\*\s+/, ''));
                  }
                }
              }

              // Format as bullet points with line breaks
              processedContent = listItems.map(item => `• ${item}`).join('<br>');

              // Preserve markdown formatting like bold and italic within list items
              processedContent = processedContent
                .replace(/\*\*(.*?)\*\*/g, '**$1**')  // Preserve bold
                .replace(/_(.*?)_/g, '_$1_');         // Preserve italic
            } else {
              // For cells without lists but with markdown, preserve the markdown formatting
              processedContent = cellContent
                .replace(/<\/?strong>/g, '**')  // Convert HTML bold to markdown
                .replace(/<\/?em>/g, '_')       // Convert HTML italic to markdown
                .replace(/<\/?b>/g, '**')       // Convert HTML bold to markdown
                .replace(/<\/?i>/g, '_')        // Convert HTML italic to markdown
                .replace(/<br\s*\/?>/g, '<br>') // Preserve line breaks as <br> tags
                .replace(/<p\s*\/?>/g, '')      // Remove opening paragraph tags
                .replace(/<\/p>/g, '<br>');     // Convert closing paragraph tags to line breaks
            }
          } else {
            // For regular HTML cells without markdown
            processedContent = processedContent
              .replace(/<\/?strong>/g, '**')  // Bold
              .replace(/<\/?em>/g, '_')       // Italic
              .replace(/<\/?b>/g, '**')       // Bold
              .replace(/<\/?i>/g, '_')        // Italic
              .replace(/<br\s*\/?>/g, '<br>') // Preserve line breaks as <br> tags
              .replace(/<p\s*\/?>/g, '')      // Opening paragraph tags
              .replace(/<\/p>/g, '<br>');     // Convert closing paragraph tags to line breaks
          }

          // Strip any remaining HTML tags, but preserve markdown syntax and <br> tags
          processedContent = processedContent
            .replace(/<(?!\/?br\b)[^>]*>/g, '') // Remove all HTML tags except <br>
            .trim();

          return sanitizeCell(processedContent);
        });

      // Ensure each row has the same number of cells as headers
      while (cells.length < headers.length) {
        cells.push('');
      }

      mdTable += '| ' + cells.join(' | ') + ' |\n';
    }

    return mdTable;
  } catch (error) {
    console.error('Error converting single HTML table:', error);
    return null;
  }
}

/**
 * Sanitizes a cell's content for use in a markdown table
 * @param content The cell content
 * @returns Sanitized content
 */
function sanitizeCell(content: string): string {
  // Trim whitespace
  let sanitized = content.trim();

  // Normalize pipe characters in content (escape them)
  sanitized = sanitized.replace(/\|/g, '\\|');

  // Preserve line breaks
  sanitized = sanitized.replace(/\n/g, '<br>');

  // Keep existing <br> tags intact (don't escape them)
  sanitized = sanitized.replace(/&lt;br&gt;/g, '<br>');

  // Preserve markdown formatting
  sanitized = sanitized
    .replace(/\\\*\\\*/g, '**')  // Fix escaped bold markers
    .replace(/\\\*/g, '*')       // Fix escaped list markers
    .replace(/\\_/g, '_');       // Fix escaped italic markers

  return sanitized;
}


if (typeof window === 'undefined') {
  global.DOMParser = class DOMParser {
    parseFromString(htmlString: string, mimeType: string) {
      const dom = new JSDOM(htmlString, {contentType: mimeType});
      return dom.window.document;
    }
  };
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Counts occurrences of a specific character in a string
 */
function countChar(text: string, char: string): number {
  return (text.match(new RegExp(escapeRegExp(char), 'g')) || []).length;
}

/**
 * Processes formatted text and moves colons outside the formatting markers
 */
function processFormattedText(text: string, openMarker: string, closeMarker: string): string {
  const pattern = new RegExp(`${escapeRegExp(openMarker)}(.*?)${escapeRegExp(closeMarker)}`, 'g');

  return text.replace(pattern, (match, content) => {
    // Check if content contains colon
    if (content.includes(':') || content.includes('：')) {
      // Count colons before removing them
      const standardColonCount = countChar(content, ':');
      const wideColonCount = countChar(content, '：');

      // Remove colons and trim content
      const trimmedContent = content.replace(/[:：]/g, '').trim();

      // Add colons back outside the formatting
      const standardColons = ':'.repeat(standardColonCount);
      const wideColons = '：'.repeat(wideColonCount);

      return `${openMarker}${trimmedContent}${closeMarker}${standardColons}${wideColons}`;
    }
    return match;
  });
}

/**
 * Repairs markdown by:
 * 1. Removing <hr> and <br> tags that are not inside tables
 * 2. Moving colons outside of bold and italic formatting
 *
 * @param markdown - The markdown string to repair
 * @returns The repaired markdown, or the original if an error occurs
 */
export function repairMarkdownFinal(markdown: string): string {
  try {
    let repairedMarkdown = markdown;

    // remove any '�'
    repairedMarkdown = repairedMarkdown.replace(/�/g, '');
    // remove any <center> tags
    repairedMarkdown = repairedMarkdown.replace(/<\/?center>/g, '');

    // Step 1: Handle <hr> and <br> tags outside tables

    // First, identify table regions to exclude them from the replacement
    const tableRegions: Array<[number, number]> = [];

    // Find HTML tables
    const htmlTableRegex = /<table[\s\S]*?<\/table>/g;
    let htmlTableMatch;
    while ((htmlTableMatch = htmlTableRegex.exec(repairedMarkdown)) !== null) {
      tableRegions.push([htmlTableMatch.index, htmlTableMatch.index + htmlTableMatch[0].length]);
    }

    // Find markdown tables
    const lines = repairedMarkdown.split('\n');
    let inMarkdownTable = false;
    let markdownTableStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('|') && line.includes('|', 1)) {
        if (!inMarkdownTable) {
          inMarkdownTable = true;
          markdownTableStart = repairedMarkdown.indexOf(lines[i]);
        }
      } else if (inMarkdownTable && line === '') {
        inMarkdownTable = false;
        const tableEnd = repairedMarkdown.indexOf(lines[i - 1]) + lines[i - 1].length;
        tableRegions.push([markdownTableStart, tableEnd]);
      }
    }

    if (inMarkdownTable) {
      const tableEnd = repairedMarkdown.length;
      tableRegions.push([markdownTableStart, tableEnd]);
    }

    // Check if an index is inside any table region
    const isInTable = (index: number): boolean => {
      return tableRegions.some(([start, end]) => index >= start && index < end);
    };

    // Remove <hr> and <br> tags outside tables
    let result = '';
    let i = 0;

    while (i < repairedMarkdown.length) {
      if (repairedMarkdown.substring(i, i + 4) === '<hr>' && !isInTable(i)) {
        i += 4;
      } else if (repairedMarkdown.substring(i, i + 4) === '<br>' && !isInTable(i)) {
        i += 4;
      } else {
        result += repairedMarkdown[i];
        i++;
      }
    }

    repairedMarkdown = result;

    // Step 2: Fix formatting with colons
    // Process from most specific (longest) patterns to most general
    const formattingPatterns = [
      ['****', '****'], // Four asterisks
      ['****', '***'],  // Four opening, three closing
      ['***', '****'],  // Three opening, four closing
      ['***', '***'],   // Three asterisks
      ['**', '**'],     // Two asterisks (bold)
      ['*', '*']        // One asterisk (italic)
    ];

    for (const [open, close] of formattingPatterns) {
      repairedMarkdown = processFormattedText(repairedMarkdown, open, close);
    }

    return repairedMarkdown;
  } catch (error) {
    // Return the original markdown if any error occurs
    return markdown;
  }
}

export async function detectBrokenUnicodeViaFileIO(str: string) {
  // Create a unique filename using timestamp and random string
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 10);
  const tempFilePath = `./temp_unicode_check_${timestamp}_${randomStr}.txt`;

  // Write the string to a file (forcing encoding/decoding)
  await fs.writeFile(tempFilePath, str, 'utf8');

  // Read it back
  const readStr = await fs.readFile(tempFilePath, 'utf8');

  // Clean up
  await fs.unlink(tempFilePath);

  // Now check for the visible replacement character
  return {broken: readStr.includes('�'), readStr};
}

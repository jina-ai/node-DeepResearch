import {BoostedSearchSnippet, ImageObject, KnowledgeItem, SearchSnippet, TrackerContext, VisitAction, WebContent} from "../types";
import {getI18nText, smartMergeStrings} from "./text-tools";
import {rerankDocuments} from "../tools/jina-rerank";
import {readUrl} from "../tools/read";
import {Schemas} from "./schemas";
import {cherryPick} from "../tools/jina-latechunk";
import {formatDateBasedOnType} from "./date-tools";
import {classifyText} from "../tools/jina-classify-spam";
import { processImage } from "./image-tools";
import {segmentText} from "../tools/segment";
import axiosClient from "./axios-client";

export function normalizeUrl(urlString: string, debug = false, options = {
  removeAnchors: true,
  removeSessionIDs: true,
  removeUTMParams: true,
  removeTrackingParams: true,
  removeXAnalytics: true  // New option to control x.com /analytics removal
}) {
  try {
    urlString = urlString.replace(/\s+/g, '').trim();

    if (!urlString?.trim()) {
      throw new Error('Empty URL');
    }

    if (urlString.startsWith('https://google.com/') || urlString.startsWith('https://www.google.com') || urlString.startsWith('https://baidu.com/s?')) {
      throw new Error('Google/baidu search link');
    }

    if (urlString.includes('example.com')) {
      throw new Error('Example URL');
    }

    // Handle x.com and twitter.com URLs with /analytics
    if (options.removeXAnalytics) {
      // Match with or without query parameters and fragments
      const xComPattern = /^(https?:\/\/(www\.)?(x\.com|twitter\.com)\/([^/]+)\/status\/(\d+))\/analytics(\/)?(\?.*)?(#.*)?$/i;
      const xMatch = urlString.match(xComPattern);
      if (xMatch) {
        // Preserve query parameters and fragments if present
        let cleanUrl = xMatch[1]; // Base URL without /analytics
        if (xMatch[7]) cleanUrl += xMatch[7]; // Add query parameters if present
        if (xMatch[8]) cleanUrl += xMatch[8]; // Add fragment if present
        urlString = cleanUrl;
      }
    }

    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }

    url.hostname = url.hostname.toLowerCase();
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
    }

    if ((url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }

    // Path normalization with error tracking
    url.pathname = url.pathname
      .split('/')
      .map(segment => {
        try {
          return decodeURIComponent(segment);
        } catch (e) {
          if (debug) console.error(`Failed to decode path segment: ${segment}`, e);
          return segment;
        }
      })
      .join('/')
      .replace(/\/+/g, '/')
      .replace(/\/+$/, '') || '/';

    // Query parameter normalization with error details
    const searchParams = new URLSearchParams(url.search);
    const sortedParams = Array.from(searchParams.entries())
      .map(([key, value]) => {
        if (value === '') return [key, ''];
        try {
          const decodedValue = decodeURIComponent(value);
          if (encodeURIComponent(decodedValue) === value) {
            return [key, decodedValue];
          }
        } catch (e) {
          if (debug) console.error(`Failed to decode query param ${key}=${value}`, e);
        }
        return [key, value];
      })
      // Filter out tracking, session and UTM parameters
      .filter(([key]) => {
        if (key === '') return false;

        // Remove session IDs
        if (options.removeSessionIDs &&
          /^(s|session|sid|sessionid|phpsessid|jsessionid|aspsessionid|asp\.net_sessionid)$/i.test(key)) {
          return false;
        }

        // Remove UTM parameters
        if (options.removeUTMParams && /^utm_/i.test(key)) {
          return false;
        }

        // Remove common tracking parameters
        if (options.removeTrackingParams &&
          /^(ref|referrer|fbclid|gclid|cid|mcid|source|medium|campaign|term|content|sc_rid|mc_[a-z]+)$/i.test(key)) {
          return false;
        }

        return true;
      })
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

    url.search = new URLSearchParams(sortedParams).toString();

    // Fragment (anchor) handling - remove completely if requested
    if (options.removeAnchors) {
      url.hash = '';
    } else if (url.hash === '#' || url.hash === '#top' || url.hash === '#/' || !url.hash) {
      url.hash = '';
    } else if (url.hash) {
      try {
        const decodedHash = decodeURIComponent(url.hash.slice(1));
        const encodedBack = encodeURIComponent(decodedHash);
        // Only use decoded version if it's safe
        if (encodedBack === url.hash.slice(1)) {
          url.hash = '#' + decodedHash;
        }
      } catch (e) {
        if (debug) console.error(`Failed to decode fragment: ${url.hash}`, e);
      }
    }

    let normalizedUrl = url.toString();

    // Remove trailing slash from paths that aren't just "/"
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    // Final URL normalization with validation
    try {
      const decodedUrl = decodeURIComponent(normalizedUrl);
      const encodedBack = encodeURIComponent(decodedUrl);
      // Only use decoded version if it's safe
      if (encodedBack === normalizedUrl) {
        normalizedUrl = decodedUrl;
      }
    } catch (e) {
      if (debug) console.error('Failed to decode final URL', e);
    }

    return normalizedUrl;
  } catch (error) {
    // Main URL parsing error - this one we should throw
    console.error(`Invalid URL "${urlString}": ${error}`);
    return;
  }
}

export function filterURLs(allURLs: Record<string, SearchSnippet>, visitedURLs: string[], badHostnames: string[], onlyHostnames: string[]): SearchSnippet[] {
  return Object.entries(allURLs)
    .filter(([url,]) => !visitedURLs.includes(url) && !badHostnames.includes(extractUrlParts(url).hostname) && (onlyHostnames.length === 0 || onlyHostnames.includes(extractUrlParts(url).hostname)))
    .map(([, result]) => result);
}


// Function to extract hostname and path from a URL
const extractUrlParts = (urlStr: string) => {
  try {
    const url = new URL(urlStr);
    return {
      hostname: url.hostname.startsWith('www.') ? url.hostname.slice(4) : url.hostname,
      path: url.pathname
    };
  } catch (e) {
    console.error(`Error parsing URL: ${urlStr}`, e);
    return { hostname: "", path: "" };
  }
};

export const normalizeHostName = (hostStr: string) => {
  const extract = extractUrlParts(hostStr);
  const host = extract.hostname;
  if (!host) {
    return hostStr.startsWith('www.') ? hostStr.slice(4).toLowerCase() : hostStr.toLowerCase();
  }
  return host;
}

// Function to count occurrences of hostnames and paths
export const countUrlParts = (urlItems: SearchSnippet[]) => {
  const hostnameCount: Record<string, number> = {};
  const pathPrefixCount: Record<string, number> = {};
  let totalUrls = 0;

  urlItems.forEach(item => {
    item = (item as { title: string; url: string; description: string; weight?: number })
    if (!item || !item.url) return; // Skip invalid items

    totalUrls++;
    const { hostname, path } = extractUrlParts(item.url);

    // Count hostnames
    hostnameCount[hostname] = (hostnameCount[hostname] || 0) + 1;

    // Count path prefixes (segments)
    const pathSegments = path.split('/').filter(segment => segment.length > 0);
    pathSegments.forEach((segment, index) => {
      const prefix = '/' + pathSegments.slice(0, index + 1).join('/');
      pathPrefixCount[prefix] = (pathPrefixCount[prefix] || 0) + 1;
    });
  });

  return { hostnameCount, pathPrefixCount, totalUrls };
};

// Calculate normalized frequency for boosting
const normalizeCount = (count: any, total: any) => {
  return total > 0 ? count / total : 0;
};

// Calculate boosted weights
export const rankURLs = (urlItems: SearchSnippet[], options: any = {}, trackers: TrackerContext): any[] => {
  // Default parameters for boosting - can be overridden
  const {
    freqFactor = 0.5,           // How much to boost based on term frequency
    hostnameBoostFactor = 0.5,  // How much to boost based on hostname frequency
    pathBoostFactor = 0.4,      // How much to boost based on path frequency
    decayFactor = 0.8,          // Decay factor for longer paths (0-1)
    jinaRerankFactor = 0.8,     // How much to boost based on Jina reranking
    minBoost = 0,               // Minimum boost score
    maxBoost = 5,                // Maximum boost score cap
    question = '',              // Optional question for Jina reranking
    boostHostnames = [],        // Optional hostnames to boost
  } = options;

  // Count URL parts first
  const counts = countUrlParts(urlItems);
  const { hostnameCount, pathPrefixCount, totalUrls } = counts;

  if (question.trim().length > 0) {
    // Step 1: Create a record to track unique content with their original indices
    const uniqueContentMap: Record<string, number[]> = {};

    urlItems.forEach((item, originalIndex) => {
      const mergedContent = smartMergeStrings(item.title, item.description);

      if (!uniqueContentMap[mergedContent]) {
        uniqueContentMap[mergedContent] = [originalIndex];
      } else {
        uniqueContentMap[mergedContent].push(originalIndex);
      }
    });

    // Step 2: Rerank only the unique contents
    const uniqueContents = Object.keys(uniqueContentMap);
    const uniqueIndicesMap = Object.values(uniqueContentMap);
    console.log(`rerank URLs: ${urlItems.length}->${uniqueContents.length}`)
    rerankDocuments(question, uniqueContents, trackers.tokenTracker)
      .then(({ results }) => {
        // Step 3: Map the scores back to all original items
        results.forEach(({ index, relevance_score }) => {
          const originalIndices = uniqueIndicesMap[index];
          const boost = relevance_score * jinaRerankFactor;

          // Apply the same boost to all items with identical content
          originalIndices.forEach((originalIndex: number) => {
            (urlItems[originalIndex] as BoostedSearchSnippet).jinaRerankBoost = boost;
          });
        });
      });
  }


  return (urlItems as BoostedSearchSnippet[]).map(item => {
    if (!item || !item.url) {
      console.error('Skipping invalid item:', item);
      return item; // Return unchanged
    }

    const { hostname, path } = extractUrlParts(item.url);

    // Base weight from original
    const freq = item.weight || 0; // Default to 1 if weight is missing

    // Hostname boost (normalized by total URLs)
    const hostnameFreq = normalizeCount(hostnameCount[hostname] || 0, totalUrls);
    const hostnameBoost = hostnameFreq * hostnameBoostFactor + (boostHostnames.includes(hostname) ? 2 : 0);

    // Path boost (consider all path prefixes with decay for longer paths)
    let pathBoost = 0;
    const pathSegments = path.split('/').filter(segment => segment.length > 0);
    pathSegments.forEach((segment, index) => {
      const prefix = '/' + pathSegments.slice(0, index + 1).join('/');
      const prefixCount = pathPrefixCount[prefix] || 0;
      const prefixFreq = normalizeCount(prefixCount, totalUrls);

      // Apply decay factor based on path depth
      const decayedBoost = prefixFreq * Math.pow(decayFactor, index) * pathBoostFactor;
      pathBoost += decayedBoost;
    });

    const freqBoost = freq / totalUrls * freqFactor;
    const jinaRerankBoost = item.jinaRerankBoost || 0;
    // Calculate new weight with clamping
    const finalScore = Math.min(
      Math.max(
        hostnameBoost
        + pathBoost
        + freqBoost
        + jinaRerankBoost, minBoost),
      maxBoost);

    return {
      ...item,
      freqBoost,
      hostnameBoost,
      pathBoost,
      jinaRerankBoost,
      finalScore
    } as BoostedSearchSnippet;
  }).sort((a, b) => b.finalScore - a.finalScore);
};

export const addToAllURLs = (r: SearchSnippet, allURLs: Record<string, SearchSnippet>, weightDelta = 1) => {
  const nURL = normalizeUrl(r.url);
  if (!nURL) return 0;
  if (!allURLs[nURL]) {
    allURLs[nURL] = r;
    allURLs[nURL].weight = weightDelta;
    return 1;
  } else {
    (allURLs[nURL].weight as number) += weightDelta;
    const curDesc = allURLs[nURL].description;
    allURLs[nURL].description = smartMergeStrings(curDesc, r.description);
    return 0;
  }
}

export const sortSelectURLs = (allURLs: BoostedSearchSnippet[], maxURLs = 70): any[] => {
  if (!allURLs || allURLs.length === 0) return [];

  return (allURLs)
    .map(r => {
      const merged = smartMergeStrings(r.title, r.description);
      return {
        url: r.url,
        score: r.finalScore,
        merged
      };
    })
    .filter(item => item.merged !== '' && item.merged !== undefined && item.merged !== null)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, maxURLs);
}


/**
 * Draw a sample from a multinomial distribution
 * @param items Array of [name, weight] tuples
 * @returns A randomly selected item based on the weights, or null if array is empty
 */
export function sampleMultinomial<T>(items: [T, number][]): T | null {
  // Handle empty array
  if (!items || items.length === 0) {
    return null;
  }

  // Calculate total weight
  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0);

  // Handle case where all weights are 0
  if (totalWeight === 0) {
    return null;
  }

  // Generate a random number between 0 and total weight
  const randValue = Math.random() * totalWeight;

  // Find the item corresponding to the random value
  let cumulativeWeight = 0;

  for (const [item, weight] of items) {
    cumulativeWeight += weight;
    if (randValue <= cumulativeWeight) {
      return item;
    }
  }

  // Fallback (should rarely happen due to floating point precision)
  return items[items.length - 1][0];
}


/**
 * Fetches the last modified date for a URL using the datetime detection API
 * @param url The URL to check for last modified date
 * @returns Promise containing the last modified date or null if not found
 */
export async function getLastModified(url: string): Promise<string | undefined> {
  try {
    // Call the API with proper encoding
    const apiUrl = `https://api-beta-datetime.jina.ai?url=${encodeURIComponent(url)}`;

    const response = await axiosClient.get(apiUrl, {
      timeout: 10000,
    });

    const data = response.data;

    // Return the bestGuess date if available
    if (data.bestGuess && data.confidence >= 70) {
      return data.bestGuess;
    }

    return undefined;
  } catch (error) {
    console.error('Failed to fetch last modified date:');
    return undefined;
  }
}


export const keepKPerHostname = (results: BoostedSearchSnippet[], k: number) => {
  // First count unique hostnames
  const uniqueHostnames = new Set(results.map(result => extractUrlParts(result.url).hostname));

  // If only one or zero unique hostnames, return original results
  if (uniqueHostnames.size <= 1) {
    return results;
  }

  const hostnameMap: Record<string, number> = {};
  const filteredResults: BoostedSearchSnippet[] = [];

  results.forEach((result) => {
    const hostname = extractUrlParts(result.url).hostname;
    if (hostnameMap[hostname] === undefined) {
      hostnameMap[hostname] = 0;
    }

    if (hostnameMap[hostname] < k) {
      filteredResults.push(result);
      hostnameMap[hostname]++;
    }
  });

  return filteredResults;
}

export async function processURLs(
  urls: string[],
  context: TrackerContext,
  allKnowledge: KnowledgeItem[],
  allURLs: Record<string, SearchSnippet>,
  visitedURLs: string[],
  badURLs: string[],
  imageObjects: ImageObject[],
  schemaGen: Schemas,
  question: string,
  webContents: Record<string, WebContent>,
  withImages: boolean = false,
): Promise<{ urlResults: any[], success: boolean }> {
  // Skip if no URLs to process
  if (urls.length === 0) {
    return { urlResults: [], success: false };
  }

  const badHostnames: string[] = [];

  // Track the reading action
  const thisStep: VisitAction = {
    action: 'visit',
    think: getI18nText('read_for', schemaGen.languageCode, { urls: urls.join(', ') }),
    URLTargets: urls
  }
  context.actionTracker.trackAction({ thisStep })

  // Process each URL in parallel
  const urlResults = await Promise.all(
    urls.map(async url => {
      try {
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
          return null;
        }

        // Store normalized URL for consistent reference
        url = normalizedUrl;

        const {response} = await readUrl(url, true, context.tokenTracker, withImages);
        const {data} = response;
        const guessedTime = await getLastModified(url);
        if (guessedTime) {
          console.log('Guessed time for', url, guessedTime);
        }

        // Early return if no valid data
        if (!data?.url || !data?.content) {
          throw new Error('No content found');
        }

        // check if content is likely a blocked msg from paywall, bot detection, etc.
        // only check for <5000 char length content as most blocking msg is short
        const spamDetectLength = 300;
        const isGoodContent = data.content.length > spamDetectLength || !await classifyText(data.content);
        if (!isGoodContent) {
          console.error(`Blocked content ${data.content.length}:`, url, data.content.slice(0, spamDetectLength));
          throw new Error(`Blocked content ${url}`);
        }

        // add to web contents
        const { chunks, chunk_positions } = await segmentText(data.content, context);
        // filter out the chunks that are too short, minChunkLength is 80
        const minChunkLength = 80;
        for (let i = 0; i < chunks.length; i++) {
          if (chunks[i].length < minChunkLength) {
            chunks.splice(i, 1);
            chunk_positions.splice(i, 1);
            i--;
          }
        }
        webContents[data.url] = {
          // full: data.content,
          chunks,
          chunk_positions,
          title: data.title
        }

        // Add to knowledge base
        allKnowledge.push({
          question: `What do expert say about "${question}"?`,
          answer: await cherryPick(question, data.content, {}, context, schemaGen, url),
          references: [data.url],
          type: 'url',
          updated: guessedTime ? formatDateBasedOnType(new Date(guessedTime), 'full') : undefined
        });

        // Process page links
        data.links?.forEach(link => {
          const nnUrl = normalizeUrl(link[1]);
          if (!nnUrl) return;
          const r: SearchSnippet = {
            title: link[0],
            url: nnUrl,
            description: link[0],
          }
          // in-page link has lower initial weight comparing to search links
          if (r.url) {
            addToAllURLs(r, allURLs, 0.1);
          }
        });

        // Process images
        if (withImages && data.images) {
          const imageEntries = Object.entries(data.images || {});
          imageEntries.forEach(async ([alt, url]) => {
            const imageObject = await processImage(url, context.tokenTracker);
            if (imageObject && !imageObjects.find(i => i.url === imageObject.url)) {
              imageObjects.push(imageObject);
            }
          });
        }

        return {url, result: response};
      } catch (error: any) {
        console.error('Error reading URL:', url, error);
        badURLs.push(url);
        // Extract hostname from the URL
        if (
          (error?.name === 'ParamValidationError' && error.message?.includes('Domain')) ||
          (error?.name === 'AssertionFailureError' && error.message?.includes('resolve host name')) ||
          error?.message?.includes("Couldn't resolve host name") ||
          error?.message?.includes("could not be resolved") ||
          error?.message?.includes("ERR_CERT_COMMON_NAME_INVALID") ||
          error?.message?.includes("ERR_CONNECTION_REFUSED")
        ) {
          let hostname = '';
          try {
            hostname = extractUrlParts(url).hostname;
          } catch (e) {
            console.error('Error parsing URL for hostname:', url, e);
          }
          badHostnames.push(hostname);
          console.log(`Added ${hostname} to bad hostnames list`);
        }
        return null;
      } finally {
        // Only add valid URLs to visitedURLs list
        if (url) {
          visitedURLs.push(url);

          // acknowledge the visit action is done for this URL
          context.actionTracker.trackAction({
            thisStep: {
              action: 'visit',
              think: '',
              URLTargets: [url]
            } as VisitAction
          })
        }
      }
    })
  );

  // Filter out null results without changing the original array
  const validResults = urlResults.filter(Boolean);

  // remove any URL with bad hostnames from allURLs
  if (badHostnames.length > 0) {
    Object.keys(allURLs).forEach(url => {
      if (badHostnames.includes(extractUrlParts(url).hostname)) {
        delete allURLs[url];
        console.log(`Removed ${url} from allURLs`);
      }
    }
    )
  }

  return {
    urlResults: validResults,
    success: validResults.length > 0,
  };
}

export function fixBadURLMdLinks(mdContent: string, allURLs: Record<string, SearchSnippet>): string {
  // Regular expression to find markdown links with the pattern [url](url)
  const mdLinkRegex = /\[([^\]]+)]\(([^)]+)\)/g;

  // Replace each match with a prettier version
  return mdContent.replace(mdLinkRegex, (match, text, url) => {
    // Check if the text and URL are the same
    if (text === url) {
      // Look up the URL directly in the record using the url as key
      const urlInfo = allURLs[url];

      if (urlInfo) {
        try {
          // Extract hostname from the URL
          const hostname = new URL(url).hostname;

          // If title is available, use [title - hostname](url) format
          if (urlInfo.title) {
            return `[${urlInfo.title} - ${hostname}](${url})`;
          }
          // Otherwise use [hostname](url) format
          else {
            return `[${hostname}](${url})`;
          }
        } catch (e) {
          // If URL parsing fails, return the original link
          return match;
        }
      } else {
        // If URL is not in allURLs, try to extract hostname
        try {
          const hostname = new URL(url).hostname;
          return `[${hostname}](${url})`;
        } catch (e) {
          // If URL parsing fails, return the original link
          return match;
        }
      }
    } else {
      // If the text and URL are not the same, leave the link as is
      return match;
    }
  });
}

export function extractUrlsWithDescription(text: string, contextWindowSize: number = 50): SearchSnippet[] {
  // Using a more precise regex for URL detection that works with multilingual text
  // This matches URLs starting with http:// or https:// but avoids capturing trailing punctuation
  const urlPattern = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;

  // Find all matches
  const matches: Array<{ url: string, index: number, length: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(text)) !== null) {
    let url = match[0];
    let length = url.length;

    // Clean trailing punctuation (period, comma, etc.)
    if (/[.,;:!?)]$/.test(url)) {
      url = url.substring(0, url.length - 1);
      length = url.length;
      // Adjust lastIndex to avoid infinite loop with zero-width matches
      urlPattern.lastIndex = match.index + length;
    }

    matches.push({
      url,
      index: match.index,
      length
    });
  }

  // If no URLs found, return empty array
  if (matches.length === 0) {
    return [];
  }

  // Extract context for each URL
  const results: SearchSnippet[] = [];

  for (let i = 0; i < matches.length; i++) {
    const { url, index, length } = matches[i];

    // Calculate boundaries for context
    let startPos = Math.max(0, index - contextWindowSize);
    let endPos = Math.min(text.length, index + length + contextWindowSize);

    // Adjust boundaries to avoid overlapping with other URLs
    if (i > 0) {
      const prevUrl = matches[i - 1];
      if (startPos < prevUrl.index + prevUrl.length) {
        startPos = prevUrl.index + prevUrl.length;
      }
    }

    if (i < matches.length - 1) {
      const nextUrl = matches[i + 1];
      if (endPos > nextUrl.index) {
        endPos = nextUrl.index;
      }
    }

    // Extract context
    const beforeText = text.substring(startPos, index);
    const afterText = text.substring(index + length, endPos);

    // Combine into description
    let description = '';
    if (beforeText && afterText) {
      description = `${beforeText.trim()} ... ${afterText.trim()}`;
    } else if (beforeText) {
      description = beforeText.trim();
    } else if (afterText) {
      description = afterText.trim();
    } else {
      description = 'No context available';
    }

    // Clean up description
    description = description.replace(/\s+/g, ' ').trim();

    results.push({
      url,
      description,
      title: '' // Maintaining the title field as required by SearchSnippet interface
    });
  }

  return results;
}
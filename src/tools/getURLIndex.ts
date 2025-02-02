import { SearchResult, QueryResult, StepData } from '../types';

export function buildURLMap(data: StepData[]): Record<string, SearchResult['url'], QueryResult['query']> {
  const urlMap: Record<string, string> = {};

  data.forEach(step => {
    if (step.result && Array.isArray(step.result)) {
      step.result.forEach(queryResult => {
        if (queryResult.results && Array.isArray(queryResult.results)) {
          queryResult.results.forEach(result => {
            if (!urlMap[result.url]) {
              urlMap[result.url] = `${result.title}`;
            }
          });
        }
      });
    }
  });

  return urlMap;
}

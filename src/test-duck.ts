import {search, SafeSearchType} from 'duck-duck-scrape';

const query = process.argv[2] || "jina ai";
async function runTest() {
  try {
    const results = await search(query, {
      safeSearch: SafeSearchType.STRICT
    });
    console.log('Search results:', results);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest();


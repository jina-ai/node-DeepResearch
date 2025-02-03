import { braveSearch } from '../brave-search';

describe('braveSearch', () => {
  it('should return search results', async () => {
    const { response } = await braveSearch('test query');
    expect(response.web.results).toBeDefined();
    expect(response.web.results.length).toBeGreaterThan(0);
    expect(response.web.results[0]).toHaveProperty('title');
    expect(response.web.results[0]).toHaveProperty('url');
    expect(response.web.results[0]).toHaveProperty('description');
  });
});

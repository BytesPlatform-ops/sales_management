import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID || '';
const BASE_URL = 'https://www.googleapis.com/customsearch/v1';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  searchSuccess: boolean;
  error?: string;
}

function isConfigured(): boolean {
  return !!(GOOGLE_API_KEY && GOOGLE_SEARCH_ENGINE_ID);
}

async function searchBusiness(query: string): Promise<SearchResponse> {
  console.log(`[GOOGLE] Searching for: ${query}`);

  if (!isConfigured()) {
    return { query, results: [], searchSuccess: false, error: 'Google Search API credentials not configured' };
  }

  try {
    const response = await axios.get(BASE_URL, {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 10,
      },
      timeout: 10000,
    });

    const results = response.data.items?.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })) || [];

    return { query, results, searchSuccess: true };
  } catch (error: any) {
    console.error(`[GOOGLE] Search failed for query "${query}":`, error.message);
    return { query, results: [], searchSuccess: false, error: error.message };
  }
}

function isValidWebsiteUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const invalidExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip'];
    const pathname = urlObj.pathname.toLowerCase();
    if (invalidExtensions.some(ext => pathname.endsWith(ext))) return false;

    const invalidDomains = ['google.com', 'youtube.com', 'facebook.com', 'linkedin.com', 'twitter.com', 'instagram.com'];
    const hostname = urlObj.hostname.toLowerCase();
    if (invalidDomains.some(domain => hostname.includes(domain))) return false;

    if (!urlObj.protocol.startsWith('http')) return false;
    return true;
  } catch {
    return false;
  }
}

function buildSearchQueries(businessName: string, state?: string, zipCode?: string): string[] {
  const queries: string[] = [];
  if (state && zipCode) queries.push(`${businessName} ${state} ${zipCode}`);
  if (state) queries.push(`${businessName} ${state}`);
  if (zipCode) queries.push(`${businessName} ${zipCode}`);
  queries.push(businessName);
  queries.push(`"${businessName}"`);
  return Array.from(new Set(queries));
}

export async function searchByDomain(domain: string): Promise<SearchResponse> {
  return searchBusiness(`site:${domain}`);
}

export async function searchByBusinessName(businessName: string, state?: string, zipCode?: string): Promise<SearchResponse> {
  const searchQueries = buildSearchQueries(businessName, state, zipCode);

  for (const query of searchQueries) {
    console.log(`[GOOGLE] Trying search query: "${query}"`);
    const searchResults = await searchBusiness(query);

    if (searchResults.results && searchResults.results.length > 0) {
      const validResults = searchResults.results.filter(result => isValidWebsiteUrl(result.url));
      if (validResults.length > 0) {
        console.log(`[GOOGLE] Found ${validResults.length} valid results with query: "${query}"`);
        return { ...searchResults, results: validResults };
      }
    }

    // Rate limit between attempts
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`[GOOGLE] No valid results found with any search query`);
  return await searchBusiness(searchQueries[searchQueries.length - 1]);
}

export { isConfigured as isGoogleSearchConfigured };

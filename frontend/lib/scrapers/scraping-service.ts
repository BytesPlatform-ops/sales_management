import * as cheerio from 'cheerio';
import { cheerioScrape, extractEmails, extractPhones, ScrapeResult } from './cheerio-scraper';
import { playwrightScrape, cleanupBrowser } from './playwright-scraper';
import { searchByBusinessName, searchByDomain, isGoogleSearchConfigured } from './google-search';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScrapedBusinessData {
  method: 'direct_url' | 'email_domain' | 'business_search' | 'fallback';
  url: string | null;
  searchQuery: string | null;
  discoveredUrl: string | null;
  homepageText: string | null;
  servicesText: string | null;
  productsText: string | null;
  solutionsText: string | null;
  featuresText: string | null;
  blogText: string | null;
  contactText: string | null;
  extractedEmails: string[];
  extractedPhones: string[];
  pageTitle: string | null;
  metaDescription: string | null;
  scrapeSuccess: boolean;
  errorMessage: string | null;
}

export interface ScrapeInput {
  website?: string;
  email?: string;
  businessName?: string;
  state?: string;
  zipCode?: string;
}

interface NavLink {
  url: string;
  label: string;
  source: string;
}

interface PageData {
  content: string;
  html: string;
  title?: string;
  url: string;
  extractedEmails: string[];
  extractedPhones: string[];
}

// Free email domains — skip email_domain strategy for these
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'live.com', 'msn.com', 'comcast.net', 'att.net', 'verizon.net',
  'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
]);

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Scrape a business website using 3-strategy pipeline:
 * 1. Direct URL (if website provided)
 * 2. Email domain search (if email has business domain)
 * 3. Google business name search (if business name provided)
 * 4. Fallback (return null — GPT works with raw CSV data only)
 */
export async function scrapeBusinessForEnrichment(input: ScrapeInput): Promise<ScrapedBusinessData> {
  console.log(`[SCRAPE-SERVICE] Starting scrape for:`, {
    website: input.website || 'none',
    email: input.email || 'none',
    businessName: input.businessName || 'none',
  });

  // Strategy 1: Direct URL
  if (input.website && input.website.trim()) {
    try {
      console.log(`[SCRAPE-SERVICE] Strategy 1: Direct URL → ${input.website}`);
      const result = await scrapeDirectUrl(input.website);
      return result;
    } catch (error: any) {
      console.error(`[SCRAPE-SERVICE] Direct URL failed: ${error.message}`);
    }
  }

  // Strategy 2: Email domain search
  if (input.email && input.email.includes('@')) {
    const domain = input.email.split('@')[1]?.toLowerCase();
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) {
      try {
        console.log(`[SCRAPE-SERVICE] Strategy 2: Email domain → ${domain}`);
        const result = await scrapeFromEmailDomain(domain);
        return result;
      } catch (error: any) {
        console.error(`[SCRAPE-SERVICE] Email domain failed: ${error.message}`);
      }
    } else {
      console.log(`[SCRAPE-SERVICE] Skipping email domain — free email provider: ${domain}`);
    }
  }

  // Strategy 3: Google business name search
  if (input.businessName && input.businessName.trim() && isGoogleSearchConfigured()) {
    try {
      console.log(`[SCRAPE-SERVICE] Strategy 3: Business search → ${input.businessName}`);
      const result = await scrapeFromBusinessSearch(input.businessName, input.state, input.zipCode);
      return result;
    } catch (error: any) {
      console.error(`[SCRAPE-SERVICE] Business search failed: ${error.message}`);
    }
  }

  // Strategy 4: Fallback — no scraping possible
  console.log(`[SCRAPE-SERVICE] All strategies exhausted — fallback (no scraped data)`);
  return {
    method: 'fallback',
    url: null,
    searchQuery: null,
    discoveredUrl: null,
    homepageText: null,
    servicesText: null,
    productsText: null,
    solutionsText: null,
    featuresText: null,
    blogText: null,
    contactText: null,
    extractedEmails: [],
    extractedPhones: [],
    pageTitle: null,
    metaDescription: null,
    scrapeSuccess: false,
    errorMessage: 'No website, business email domain, or business name available for scraping',
  };
}

// ─── Strategy 1: Direct URL ─────────────────────────────────────────────────

async function scrapeDirectUrl(website: string): Promise<ScrapedBusinessData> {
  const url = website.startsWith('http') ? website : `https://${website}`;

  // SPA detection + scrape homepage
  const isSPA = await detectSPA(url);
  let homepageData: ScrapeResult;

  if (isSPA) {
    console.log(`[SCRAPE] Detected SPA, using Playwright: ${url}`);
    homepageData = await playwrightScrape(url);
  } else {
    try {
      homepageData = await cheerioScrape(url);
    } catch {
      console.log(`[SCRAPE] Cheerio failed, trying Playwright: ${url}`);
      homepageData = await playwrightScrape(url);
    }
  }

  // Discover and scrape additional pages
  const additionalPages = await discoverAndScrapePages(url, homepageData);

  // Enrich contact info
  const { emails, phones } = enrichContactInfo(homepageData, additionalPages);

  return {
    method: 'direct_url',
    url,
    searchQuery: null,
    discoveredUrl: null,
    homepageText: homepageData.content || null,
    servicesText: additionalPages.services?.content || null,
    productsText: additionalPages.products?.content || null,
    solutionsText: additionalPages.solutions?.content || null,
    featuresText: additionalPages.features?.content || null,
    blogText: additionalPages.blog?.content || null,
    contactText: additionalPages.contact?.content || null,
    extractedEmails: emails,
    extractedPhones: phones,
    pageTitle: homepageData.title || null,
    metaDescription: homepageData.metaDescription || null,
    scrapeSuccess: homepageData.scrapeSuccess,
    errorMessage: null,
  };
}

// ─── Strategy 2: Email Domain ───────────────────────────────────────────────

async function scrapeFromEmailDomain(domain: string): Promise<ScrapedBusinessData> {
  const searchResults = await searchByDomain(domain);

  if (!searchResults.searchSuccess || !searchResults.results?.length) {
    throw new Error(`No search results found for domain: ${domain}`);
  }

  const discoveredUrl = searchResults.results[0].url;

  // Scrape discovered URL
  let homepageData: ScrapeResult;
  try {
    homepageData = await cheerioScrape(discoveredUrl);
  } catch {
    console.log(`[SCRAPE] Cheerio failed for discovered URL, trying Playwright: ${discoveredUrl}`);
    homepageData = await playwrightScrape(discoveredUrl);
  }

  const additionalPages = await discoverAndScrapePages(discoveredUrl, homepageData);
  const { emails, phones } = enrichContactInfo(homepageData, additionalPages);

  return {
    method: 'email_domain',
    url: discoveredUrl,
    searchQuery: `site:${domain}`,
    discoveredUrl,
    homepageText: homepageData.content || null,
    servicesText: additionalPages.services?.content || null,
    productsText: additionalPages.products?.content || null,
    solutionsText: additionalPages.solutions?.content || null,
    featuresText: additionalPages.features?.content || null,
    blogText: additionalPages.blog?.content || null,
    contactText: additionalPages.contact?.content || null,
    extractedEmails: emails,
    extractedPhones: phones,
    pageTitle: homepageData.title || null,
    metaDescription: homepageData.metaDescription || null,
    scrapeSuccess: homepageData.scrapeSuccess,
    errorMessage: null,
  };
}

// ─── Strategy 3: Business Search ────────────────────────────────────────────

async function scrapeFromBusinessSearch(
  businessName: string,
  state?: string,
  zipCode?: string
): Promise<ScrapedBusinessData> {
  const searchResults = await searchByBusinessName(businessName, state, zipCode);

  if (!searchResults.searchSuccess || !searchResults.results?.length) {
    throw new Error(`No search results found for business: ${businessName}`);
  }

  const discoveredUrl = searchResults.results[0].url;

  let homepageData: ScrapeResult;
  try {
    homepageData = await cheerioScrape(discoveredUrl);
  } catch {
    console.log(`[SCRAPE] Cheerio failed for discovered URL, trying Playwright: ${discoveredUrl}`);
    homepageData = await playwrightScrape(discoveredUrl);
  }

  const additionalPages = await discoverAndScrapePages(discoveredUrl, homepageData);
  const { emails, phones } = enrichContactInfo(homepageData, additionalPages);

  return {
    method: 'business_search',
    url: discoveredUrl,
    searchQuery: [businessName, state, zipCode].filter(Boolean).join(' '),
    discoveredUrl,
    homepageText: homepageData.content || null,
    servicesText: additionalPages.services?.content || null,
    productsText: additionalPages.products?.content || null,
    solutionsText: additionalPages.solutions?.content || null,
    featuresText: additionalPages.features?.content || null,
    blogText: additionalPages.blog?.content || null,
    contactText: additionalPages.contact?.content || null,
    extractedEmails: emails,
    extractedPhones: phones,
    pageTitle: homepageData.title || null,
    metaDescription: homepageData.metaDescription || null,
    scrapeSuccess: homepageData.scrapeSuccess,
    errorMessage: null,
  };
}

// ─── SPA Detection ──────────────────────────────────────────────────────────

async function detectSPA(url: string): Promise<boolean> {
  try {
    const response = await cheerioScrape(url);
    const html = response.html.toLowerCase();

    const hasReactRoot = html.includes('id="root"') || html.includes('id="app"');
    const hasReactScripts = html.includes('react') || html.includes('_react') || html.includes('react-dom');
    const hasVueIndicators = html.includes('vue') || html.includes('v-') || html.includes('@vue');
    const hasAngularIndicators = html.includes('angular') || html.includes('ng-') || html.includes('@angular');
    const contentLength = response.content.trim().length;
    const isMinimalContent = contentLength < 500;
    const hasSPAMeta = html.includes('next.js') || html.includes('nuxt') || html.includes('gatsby') ||
                       html.includes('svelte') || html.includes('preact');

    const isSPA = (hasReactRoot && (hasReactScripts || isMinimalContent)) ||
                  hasVueIndicators ||
                  hasAngularIndicators ||
                  hasSPAMeta ||
                  (isMinimalContent && hasReactRoot);

    console.log(`[SPA-DETECT] URL: ${url}, isSPA: ${isSPA}, contentLength: ${contentLength}`);
    return isSPA;
  } catch (error: any) {
    console.log(`[SPA-DETECT] Detection failed for ${url}, defaulting to Playwright: ${error.message}`);
    return true;
  }
}

// ─── Multi-Page Discovery ───────────────────────────────────────────────────

async function discoverAndScrapePages(
  baseUrl: string,
  homepageData: ScrapeResult
): Promise<Record<string, PageData>> {
  const additionalPages: Record<string, PageData> = {};

  try {
    // Step 1: Extract nav links from homepage HTML
    let navLinks: NavLink[] = [];

    if (homepageData.html) {
      navLinks = extractNavigationLinksFromHtml(homepageData.html, baseUrl);
      console.log(`[SCRAPE] Extracted ${navLinks.length} navigation links`);
    } else {
      navLinks = (homepageData.links || []).map((url: string) => ({ url, label: '', source: 'fallback' }));
    }

    // Step 2: Map links to page categories
    const pageUrls = findPageUrls(baseUrl, navLinks);
    console.log(`[SCRAPE] Mapped pages:`, Object.keys(pageUrls));

    // If no pages found, try hash sections (single-page sites)
    if (Object.keys(pageUrls).length === 0 && homepageData.html) {
      console.log(`[SCRAPE] No pages found, checking #hash sections...`);
      const hashSections = extractHashSections(homepageData.html, baseUrl);

      for (const [pageType, sectionData] of Object.entries(hashSections)) {
        additionalPages[pageType] = {
          content: sectionData.content,
          html: sectionData.html,
          title: `${pageType} section`,
          url: sectionData.url,
          extractedEmails: [],
          extractedPhones: [],
        };
      }

      if (Object.keys(hashSections).length > 0) {
        console.log(`[SCRAPE] Extracted ${Object.keys(hashSections).length} hash sections`);
      }
    }

    // Step 3: Scrape each discovered page
    for (const [pageType, url] of Object.entries(pageUrls)) {
      if (!url || typeof url !== 'string' || !isValidScrapingUrl(url)) continue;

      // Skip login/auth pages
      const urlLower = url.toLowerCase();
      if (urlLower.includes('/login') || urlLower.includes('/signin') ||
          urlLower.includes('/sign-in') || urlLower.includes('/auth') ||
          urlLower.includes('/signup') || urlLower.includes('/register')) {
        console.log(`[SCRAPE] Skipping login/auth page: ${url}`);
        continue;
      }

      try {
        console.log(`[SCRAPE] Scraping ${pageType} page: ${url}`);

        let pageData: ScrapeResult;
        try {
          pageData = await cheerioScrape(url);
        } catch {
          console.log(`[SCRAPE] Cheerio failed for ${pageType}, using Playwright`);
          pageData = await playwrightScrape(url);
        }

        additionalPages[pageType] = {
          content: pageData.content,
          html: pageData.html,
          title: pageData.title,
          url,
          extractedEmails: pageData.extractedEmails || [],
          extractedPhones: pageData.extractedPhones || [],
        };

        // Rate limit between pages
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.log(`[SCRAPE] Failed to scrape ${pageType} page: ${url} — ${error.message}`);
      }
    }
  } catch (error: any) {
    console.log(`[SCRAPE] Page discovery failed: ${error.message}`);
  }

  return additionalPages;
}

// ─── Navigation Link Extraction ─────────────────────────────────────────────

function extractNavigationLinksFromHtml(html: string, baseUrl: string): NavLink[] {
  const $ = cheerio.load(html);
  const baseUrlObj = new URL(baseUrl);
  const baseDomain = baseUrlObj.hostname.replace(/^www\./, '');
  const links: NavLink[] = [];

  const prioritySelectors = [
    'nav a[href]', 'header a[href]', '.navbar a[href]', '.menu a[href]',
    '.navigation a[href]', '[role="navigation"] a[href]', '.main-menu a[href]',
    '.primary-menu a[href]', '.wp-block-button a[href]',
  ];

  const secondarySelectors = ['footer a[href]', '.footer a[href]'];

  const normalizeUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const normalizedHost = urlObj.hostname.replace(/^www\./, '');
      return `${urlObj.protocol}//${normalizedHost}${urlObj.pathname}${urlObj.search}`;
    } catch { return url; }
  };

  const isHomepage = (url: string): boolean => {
    const normalized = normalizeUrl(url);
    const baseNormalized = normalizeUrl(baseUrl);
    return normalized === baseNormalized ||
           normalized === `${baseNormalized}/` ||
           normalized === `${baseNormalized.replace(/\/$/, '')}/`;
  };

  const extractLinks = (selector: string, source: string) => {
    $(selector).each((_, element) => {
      const href = $(element).attr('href');
      const label = $(element).text().trim();

      if (href) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          const linkDomain = new URL(fullUrl).hostname.replace(/^www\./, '');

          if (linkDomain === baseDomain &&
              !href.startsWith('#') &&
              !href.startsWith('mailto:') &&
              !href.startsWith('tel:') &&
              !isHomepage(fullUrl)) {
            links.push({ url: fullUrl, label: label ? label.toLowerCase() : '', source });
          }
        } catch { /* invalid URL */ }
      }
    });
  };

  prioritySelectors.forEach(s => extractLinks(s, 'navigation'));
  secondarySelectors.forEach(s => extractLinks(s, 'footer'));

  // Deduplicate, prefer navigation over footer
  const unique = new Map<string, NavLink>();
  links.forEach(link => {
    const key = normalizeUrl(link.url);
    if (!unique.has(key)) {
      unique.set(key, link);
    } else {
      const existing = unique.get(key)!;
      if (link.source === 'navigation' && existing.source === 'footer') {
        unique.set(key, link);
      }
    }
  });

  return Array.from(unique.values());
}

// ─── Page URL Mapping ───────────────────────────────────────────────────────

const PAGE_PATTERNS: Record<string, { urlPatterns: string[]; labelKeywords: string[] }> = {
  services: {
    urlPatterns: ['/services', '/service', '/what-we-do', '/our-services', '/offerings',
                  '/expertise', '/capabilities', '/what-we-offer', '/our-work', '/specialties', '/practice-areas'],
    labelKeywords: ['service', 'services', 'what we do', 'our services', 'offerings',
                    'expertise', 'capabilities', 'specialties', 'practice'],
  },
  products: {
    urlPatterns: ['/products', '/product', '/catalog', '/portfolio', '/gallery',
                  '/work', '/projects', '/showcase', '/case-studies', '/examples'],
    labelKeywords: ['product', 'products', 'catalog', 'portfolio', 'gallery',
                    'work', 'projects', 'showcase', 'case study', 'examples'],
  },
  contact: {
    urlPatterns: ['/contact', '/contact-us', '/get-in-touch', '/reach-us',
                  '/location', '/locations', '/office', '/offices'],
    labelKeywords: ['contact', 'contact us', 'get in touch', 'reach us', 'reach out',
                    'location', 'office', 'address'],
  },
  solutions: {
    urlPatterns: ['/solutions', '/solution', '/our-solutions', '/platform-solutions', '/business-solutions'],
    labelKeywords: ['solution', 'solutions', 'our solutions'],
  },
  features: {
    urlPatterns: ['/features', '/feature', '/product-features', '/platform-features'],
    labelKeywords: ['feature', 'features', 'product features', 'platform features'],
  },
  blog: {
    urlPatterns: ['/blog', '/blogs', '/articles', '/insights', '/news', '/resources'],
    labelKeywords: ['blog', 'blogs', 'article', 'articles', 'insight', 'insights',
                    'news', 'resource', 'resources'],
  },
};

const EXCLUDED_PATHS = ['/login', '/signin', '/sign-in', '/auth', '/signup', '/sign-up', '/register', '/account', '/dashboard', '/admin'];

function findPageUrls(baseUrl: string, links: NavLink[]): Record<string, string> {
  const baseDomain = new URL(baseUrl).hostname;
  const pageUrls: Record<string, string> = {};
  const assignedUrls = new Set<string>();
  const pageTypes = ['services', 'products', 'contact', 'solutions', 'features', 'blog'];

  for (const link of links) {
    try {
      const linkUrl = new URL(link.url);
      const pathname = linkUrl.pathname.toLowerCase();
      const label = link.label.toLowerCase();

      // Skip excluded paths
      const isExcluded = EXCLUDED_PATHS.some(ex => pathname.includes(ex)) ||
                         label.includes('login') || label.includes('sign in') ||
                         label.includes('sign up') || label.includes('register');
      if (isExcluded) continue;

      if (linkUrl.hostname !== baseDomain) continue;

      const normalizedUrl = link.url.replace(/\/$/, '').toLowerCase();
      if (assignedUrls.has(normalizedUrl)) continue;

      for (const pageType of pageTypes) {
        if (pageUrls[pageType]) continue;

        const patterns = PAGE_PATTERNS[pageType];
        let matched = false;

        // Label match first (strongest signal)
        for (const keyword of patterns.labelKeywords) {
          if (label.includes(keyword)) {
            pageUrls[pageType] = link.url;
            assignedUrls.add(normalizedUrl);
            console.log(`[SCRAPE] Mapped ${pageType} by label "${link.label}": ${link.url}`);
            matched = true;
            break;
          }
        }

        // URL pattern match
        if (!matched) {
          for (const pattern of patterns.urlPatterns) {
            if (pathname.includes(pattern) || pathname.includes(pattern.replace('/', ''))) {
              pageUrls[pageType] = link.url;
              assignedUrls.add(normalizedUrl);
              console.log(`[SCRAPE] Mapped ${pageType} by URL pattern: ${link.url}`);
              matched = true;
              break;
            }
          }
        }

        if (matched) break;
      }
    } catch { continue; }
  }

  return pageUrls;
}

// ─── Hash Section Extraction (Single-Page Sites) ────────────────────────────

const HASH_KEYWORDS: Record<string, { labelKeywords: string[]; hashKeywords: string[] }> = {
  services: {
    labelKeywords: ['service', 'services', 'what we do', 'our services', 'offerings', 'expertise', 'capabilities'],
    hashKeywords: ['services', 'service', 'what-we-do', 'our-services', 'offerings'],
  },
  products: {
    labelKeywords: ['product', 'products', 'catalog', 'portfolio', 'gallery', 'projects'],
    hashKeywords: ['products', 'product', 'catalog', 'portfolio', 'gallery', 'projects'],
  },
  contact: {
    labelKeywords: ['contact', 'contact us', 'get in touch', 'reach us', 'reach out'],
    hashKeywords: ['contact', 'contact-us', 'get-in-touch', 'reach-us'],
  },
  solutions: {
    labelKeywords: ['solution', 'solutions', 'our solutions'],
    hashKeywords: ['solutions', 'solution', 'our-solutions'],
  },
  features: {
    labelKeywords: ['feature', 'features', 'product features'],
    hashKeywords: ['features', 'feature'],
  },
  blog: {
    labelKeywords: ['blog', 'blogs', 'article', 'articles', 'news', 'resources'],
    hashKeywords: ['blog', 'blogs', 'articles', 'news', 'resources'],
  },
};

function extractHashSections(
  html: string,
  baseUrl: string
): Record<string, { content: string; html: string; url: string }> {
  const $ = cheerio.load(html);
  const result: Record<string, { content: string; html: string; url: string }> = {};

  // Collect all #hash links
  const hashLinks: Array<{ hash: string; label: string }> = [];
  $('a[href^="#"]').each((_, el) => {
    const href = $(el).attr('href');
    const label = $(el).text().trim().toLowerCase();
    if (href && href.length > 1) {
      hashLinks.push({ hash: href.substring(1), label });
    }
  });

  if (hashLinks.length === 0) return result;

  // Deduplicate
  const seen = new Set<string>();
  const uniqueHashLinks = hashLinks.filter(h => {
    if (seen.has(h.hash)) return false;
    seen.add(h.hash);
    return true;
  });

  const assignedHashes = new Set<string>();
  const pageTypes = ['services', 'products', 'contact', 'solutions', 'features', 'blog'];

  for (const hashLink of uniqueHashLinks) {
    if (assignedHashes.has(hashLink.hash)) continue;

    for (const pageType of pageTypes) {
      if (result[pageType]) continue;

      const kw = HASH_KEYWORDS[pageType];
      let matched = false;

      // Check label
      for (const keyword of kw.labelKeywords) {
        if (hashLink.label.includes(keyword)) { matched = true; break; }
      }
      // Check hash value
      if (!matched) {
        const hashLower = hashLink.hash.toLowerCase();
        for (const keyword of kw.hashKeywords) {
          if (hashLower === keyword || hashLower.includes(keyword)) { matched = true; break; }
        }
      }

      if (matched) {
        let section = $(`#${hashLink.hash}`);
        if (section.length === 0) section = $(`[data-section="${hashLink.hash}"]`);
        if (section.length === 0) section = $(`section#${hashLink.hash}`);

        if (section.length > 0) {
          const sectionHtml = section.html() || '';
          section.find('script, style').remove();
          const sectionText = section.text().replace(/\s+/g, ' ').trim();

          if (sectionText.length >= 20) {
            result[pageType] = {
              content: sectionText,
              html: sectionHtml,
              url: `${baseUrl}#${hashLink.hash}`,
            };
            assignedHashes.add(hashLink.hash);
            console.log(`[SCRAPE] Extracted ${pageType} from #${hashLink.hash} (${sectionText.length} chars)`);
            break;
          }
        }

        assignedHashes.add(hashLink.hash);
        break;
      }
    }
  }

  return result;
}

// ─── Contact Info Enrichment ────────────────────────────────────────────────

function extractFooterContactInfo(html: string): { emails: string[]; phones: string[] } {
  const $ = cheerio.load(html);
  const footerText = $('footer').text() || '';

  const footerEmails = extractEmails(footerText).filter(
    (email: string) => !email.includes('example.com') && !email.includes('test.com')
  );
  const footerPhones = extractPhones(footerText);

  return {
    emails: Array.from(new Set(footerEmails)),
    phones: Array.from(new Set(footerPhones)),
  };
}

function enrichContactInfo(
  homepageData: ScrapeResult,
  additionalPages: Record<string, PageData>
): { emails: string[]; phones: string[] } {
  let emails = homepageData.extractedEmails || [];
  let phones = homepageData.extractedPhones || [];

  // Try footer first
  if (homepageData.html && (emails.length === 0 || phones.length === 0)) {
    const footerInfo = extractFooterContactInfo(homepageData.html);

    if (footerInfo.emails.length > 0 && emails.length === 0) {
      emails = Array.from(new Set([...emails, ...footerInfo.emails]));
      console.log(`[SCRAPE] Enriched with ${footerInfo.emails.length} emails from footer`);
    }
    if (footerInfo.phones.length > 0 && phones.length === 0) {
      phones = Array.from(new Set([...phones, ...footerInfo.phones]));
      console.log(`[SCRAPE] Enriched with ${footerInfo.phones.length} phones from footer`);
    }
  }

  // Try contact page
  if (additionalPages.contact) {
    const contactEmails = additionalPages.contact.extractedEmails || [];
    const contactPhones = additionalPages.contact.extractedPhones || [];

    if (contactEmails.length > 0 && emails.length === 0) {
      emails = Array.from(new Set([...emails, ...contactEmails]));
      console.log(`[SCRAPE] Enriched with ${contactEmails.length} emails from contact page`);
    }
    if (contactPhones.length > 0 && phones.length === 0) {
      phones = Array.from(new Set([...phones, ...contactPhones]));
      console.log(`[SCRAPE] Enriched with ${contactPhones.length} phones from contact page`);
    }
  }

  return { emails, phones };
}

// ─── URL Validation ─────────────────────────────────────────────────────────

function isValidScrapingUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    if (!urlObj.protocol.startsWith('http')) return false;

    const invalidExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip'];
    const pathname = urlObj.pathname.toLowerCase();
    if (invalidExtensions.some(ext => pathname.endsWith(ext))) return false;

    const invalidDomains = ['google.com', 'youtube.com', 'facebook.com', 'linkedin.com', 'twitter.com', 'instagram.com'];
    const hostname = urlObj.hostname.toLowerCase();
    if (invalidDomains.some(domain => hostname.includes(domain))) return false;

    return true;
  } catch { return false; }
}

// Re-export cleanup for use in route handlers
export { cleanupBrowser };

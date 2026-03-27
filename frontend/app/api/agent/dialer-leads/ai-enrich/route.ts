import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { queryOne } from '@/lib/db';
import { scrapeBusinessForEnrichment, ScrapedBusinessData } from '@/lib/scrapers/scraping-service';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * POST /api/agent/dialer-leads/ai-enrich
 * Scrapes business website → feeds scraped content to GPT → generates talking points
 * focused on: (1) How to advertise the business, (2) How to reduce operational cost
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your-openai-api-key-here') {
      return NextResponse.json(
        { status: 'error', message: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { lead_id, mode = 'full' } = body; // mode: 'scrape' (website only) or 'full' (scrape + GPT)

    if (!lead_id) {
      return NextResponse.json({ status: 'error', message: 'lead_id is required' }, { status: 400 });
    }

    // Fetch lead
    const lead = await queryOne<any>(
      `SELECT id, firm_name, contact_person, phone_number, raw_data, ai_generated, assigned_agent_id, scraped_data
       FROM dialer_leads WHERE id = $1`,
      [lead_id]
    );

    if (!lead) {
      return NextResponse.json({ status: 'error', message: 'Lead not found' }, { status: 404 });
    }

    // Scrape-only mode: if already scraped, return immediately
    if (mode === 'scrape' && lead.scraped_data) {
      return NextResponse.json({
        status: 'success',
        message: 'Already scraped',
        data: { already_cached: true, scrape_success: lead.scraped_data.scrapeSuccess },
      });
    }

    // Full mode: if already enriched with GPT, return cached
    if (mode === 'full' && lead.ai_generated) {
      return NextResponse.json({
        status: 'success',
        message: 'Already enriched',
        data: { already_cached: true },
      });
    }

    const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;

    // Extract key fields from raw_data
    const website = String(Object.entries(rawData).find(([k]) => /www|url|website/i.test(k))?.[1] || '');
    const emailField = String(Object.entries(rawData).find(([k]) => /e-?mail/i.test(k))?.[1] || '');
    const capabilities = String(Object.entries(rawData).find(([k]) => /capabilities|narrative|description|business/i.test(k))?.[1] || '');
    const address = String(Object.entries(rawData).find(([k]) => /address|city|location/i.test(k))?.[1] || '');
    const stateField = String(Object.entries(rawData).find(([k]) => /^state$/i.test(k))?.[1] || '');
    const zipField = String(Object.entries(rawData).find(([k]) => /zip|postal/i.test(k))?.[1] || '');

    // Clean business name for search (remove *MAIN*, *BRANCH*, special chars)
    const cleanBusinessName = (lead.firm_name || '')
      .replace(/\*[^*]*\*/g, '')  // remove *MAIN*, *BRANCH*, etc.
      .replace(/[^\w\s&.,'-]/g, '') // remove special chars except common business chars
      .replace(/\s+/g, ' ')
      .trim();

    // Clean zip code (remove .0 decimal from CSV number formatting)
    const cleanZip = zipField.trim().replace(/\.0$/, '');

    // ─── Step 1: Scrape business website (use cached if available) ─────
    let scrapedData: ScrapedBusinessData;

    if (lead.scraped_data) {
      console.log(`[AI-ENRICH] Using cached scraped data for lead ${lead_id}`);
      scrapedData = lead.scraped_data as ScrapedBusinessData;
    } else {
      console.log(`[AI-ENRICH] Scraping business for lead ${lead_id}: ${cleanBusinessName || lead.firm_name}`);
      try {
        scrapedData = await scrapeBusinessForEnrichment({
          website: website.trim() || undefined,
          email: emailField.trim() || undefined,
          businessName: cleanBusinessName || undefined,
          state: stateField.trim() || undefined,
          zipCode: cleanZip || undefined,
        });
      } catch (scrapeError: any) {
        console.error(`[AI-ENRICH] Scraping failed for lead ${lead_id}:`, scrapeError.message);
        scrapedData = {
          method: 'fallback',
          url: null, searchQuery: null, discoveredUrl: null,
          homepageText: null, servicesText: null, productsText: null,
          solutionsText: null, featuresText: null, blogText: null, contactText: null,
          extractedEmails: [], extractedPhones: [],
          pageTitle: null, metaDescription: null,
          scrapeSuccess: false, errorMessage: scrapeError.message,
        };
      }

      // Cache scraped data in DB
      await queryOne(
        `UPDATE dialer_leads SET scraped_data = $1 WHERE id = $2`,
        [JSON.stringify(scrapedData), lead_id]
      );
    }

    // Scrape-only mode: return after caching
    if (mode === 'scrape') {
      return NextResponse.json({
        status: 'success',
        data: {
          scrape_method: scrapedData.method,
          scrape_success: scrapedData.scrapeSuccess,
        },
      });
    }

    // ─── Step 2: Build GPT prompt with scraped content ─────────────────
    const businessInfo = Object.entries(rawData)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    const hasWebsite = !!(website.trim() || scrapedData.url);
    const hasScrapedContent = scrapedData.scrapeSuccess && scrapedData.homepageText;

    // Truncate scraped content to fit token limits
    const truncate = (text: string | null, maxLen: number) =>
      text ? text.substring(0, maxLen) : '';

    const scrapedSection = hasScrapedContent
      ? `
=== SCRAPED WEBSITE CONTENT ===
Source: ${scrapedData.url || scrapedData.discoveredUrl || 'Unknown'}
Method: ${scrapedData.method}
Page Title: ${scrapedData.pageTitle || 'N/A'}
Meta Description: ${scrapedData.metaDescription || 'N/A'}

Homepage Content:
${truncate(scrapedData.homepageText, 2000)}

${scrapedData.servicesText ? `Services Page:\n${truncate(scrapedData.servicesText, 1000)}\n` : ''}
${scrapedData.productsText ? `Products Page:\n${truncate(scrapedData.productsText, 1000)}\n` : ''}
${scrapedData.contactText ? `Contact Page:\n${truncate(scrapedData.contactText, 500)}\n` : ''}
${scrapedData.extractedEmails.length > 0 ? `Found Emails: ${scrapedData.extractedEmails.join(', ')}\n` : ''}
${scrapedData.extractedPhones.length > 0 ? `Found Phones: ${scrapedData.extractedPhones.join(', ')}\n` : ''}`
      : `
=== NO WEBSITE CONTENT AVAILABLE ===
Could not scrape business website. Using raw CSV data only.
Reason: ${scrapedData.errorMessage || 'No website/email/business name available'}`;

    const prompt = `You are a sales intelligence analyst for Bytes Platform — a technology company.

=== STEP 0: IDENTIFY BUSINESS TYPE ===
First, determine if this business is:
- B2C (sells to consumers — contractors, restaurants, salons, retail, clinics, local services)
- B2B (sells to other businesses — tech companies, agencies, manufacturers, defense, consulting)

=== BUSINESS DATA (from CSV) ===
Company: ${lead.firm_name || 'Unknown'}
Contact: ${lead.contact_person || 'Unknown'}
Website: ${hasWebsite ? (website || scrapedData.url) : 'NO WEBSITE'}
Industry/Type: ${capabilities || 'Not provided'}
Location: ${address || 'Not provided'}
Email: ${emailField || 'Not provided'}
Raw Data:
${businessInfo}
${scrapedSection}

=== STEP 1: CHOOSE SERVICES BASED ON BUSINESS TYPE ===

IF B2C (local/consumer businesses):
Focus on: Website, Website Redesign, Local SEO, Google Business, Social Media, PPC Ads, Online Booking, Review Management, E-commerce
These businesses need MORE CUSTOMERS walking in or calling. Think practically:
- "Your competitors show up on Google Maps, you don't"
- "People search 'plumber near me' 10,000 times/month in your area"
- "Online booking can save you 2 hours/day on phone calls"

IF B2B (business-to-business):
Focus on: Website, SEO, Content Marketing, CRM, Business Automation, Custom Software, Data Analytics, AI Integration
These businesses need LEAD GENERATION and OPERATIONAL EFFICIENCY. Think practically:
- "Your website doesn't clearly show what problems you solve for clients"
- "A CRM pipeline can track your deals instead of spreadsheets"
- "Automating your proposal process can save 10 hours/week"

NEVER suggest these (we don't pitch them in cold calls):
- Cloud Computing
- Blockchain
- Cybersecurity
- ERP (unless manufacturing/logistics with 50+ employees)
- Mobile App (only if they have a consumer product that genuinely needs one)

=== STEP 2: WRITE TALKING POINTS ===

Respond in this exact JSON format only, no markdown:
{
  "businessType": "B2B" or "B2C",
  "what_to_offer": ["service1", "service2"],
  "talking_points": [
    "point1",
    "point2",
    "point3",
    "point4",
    "point5"
  ]
}

=== STRICT RULES ===
- what_to_offer: Pick 2-4 services that ACTUALLY make sense — don't force-fit technical services
- Choose based on business type (B2C = marketing focus, B2B = efficiency + lead gen focus)
${!hasWebsite ? '- This business has NO WEBSITE — this is the #1 priority. Lead with "You don\'t have a website, your competitors are getting all the online customers"' : ''}
${hasScrapedContent ? '- USE the scraped website content to make points SPECIFIC — mention their actual services, products, or specialties by name' : ''}
- talking_points: Write exactly 5 points:
  - Points 1-3: GROWTH angle — how to get them more customers, visibility, or better digital tools (could be SEO, app, website, AI, software — whatever fits)
  - Points 4-5: EFFICIENCY angle — how to save time/money (automation, AI chatbots, CRM, custom software, cloud — whatever fits)
  - Each point must be a COMPLETE sentence the agent can say on the phone
  - MENTION "${lead.firm_name}" or their specific business type in at least 2 points
  - Reference their LOCATION for local marketing angles
  - Each point must be DIFFERENT — don't repeat the same idea
- Keep each talking point under 150 characters
- Write in a conversational tone — these are spoken on the phone, not read in an email
- Do NOT use generic phrases like "enhance your online presence" — be SPECIFIC about the business`;

    // ─── Step 3: Call OpenAI ───────────────────────────────────────────
    const gptResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 700,
      }),
    });

    if (!gptResponse.ok) {
      const err = await gptResponse.text();
      console.error('OpenAI API error:', err);
      return NextResponse.json(
        { status: 'error', message: 'GPT API call failed' },
        { status: 500 }
      );
    }

    const gptData = await gptResponse.json();
    const content = gptData.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json(
        { status: 'error', message: 'Empty GPT response' },
        { status: 500 }
      );
    }

    // Parse GPT response
    let parsed: { what_to_offer: string[]; talking_points: string[] };
    try {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error('Failed to parse GPT response:', content);
      return NextResponse.json(
        { status: 'error', message: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    // ─── Step 4: Save to database ─────────────────────────────────────
    await queryOne(
      `UPDATE dialer_leads
       SET what_to_offer = $1,
           talking_points = $2,
           ai_generated = true,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(parsed.what_to_offer), JSON.stringify(parsed.talking_points), lead_id]
    );

    return NextResponse.json({
      status: 'success',
      data: {
        what_to_offer: parsed.what_to_offer,
        talking_points: parsed.talking_points,
        scrape_method: scrapedData.method,
        scrape_success: scrapedData.scrapeSuccess,
      },
    });
  } catch (error) {
    console.error('AI enrich error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to enrich lead' },
      { status: 500 }
    );
  }
}

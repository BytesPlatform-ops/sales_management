import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { queryOne } from '@/lib/db';

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
 * Generate "What to Offer" and "Talking Points" for a lead using GPT.
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
    const { lead_id } = body;

    if (!lead_id) {
      return NextResponse.json({ status: 'error', message: 'lead_id is required' }, { status: 400 });
    }

    // Fetch lead
    const lead = await queryOne<any>(
      `SELECT id, firm_name, contact_person, phone_number, raw_data, ai_generated, assigned_agent_id
       FROM dialer_leads WHERE id = $1`,
      [lead_id]
    );

    if (!lead) {
      return NextResponse.json({ status: 'error', message: 'Lead not found' }, { status: 404 });
    }

    // Already enriched? Return cached
    if (lead.ai_generated) {
      return NextResponse.json({
        status: 'success',
        message: 'Already enriched',
        data: { already_cached: true },
      });
    }

    const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;

    // Build context for GPT — extract key fields for better analysis
    const businessInfo = Object.entries(rawData)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    // Extract specific fields for emphasis
    const website = String(Object.entries(rawData).find(([k]) => /www|url|website/i.test(k))?.[1] || '');
    const capabilities = String(Object.entries(rawData).find(([k]) => /capabilities|narrative|description|business/i.test(k))?.[1] || '');
    const address = String(Object.entries(rawData).find(([k]) => /address|city|location/i.test(k))?.[1] || '');
    const email = String(Object.entries(rawData).find(([k]) => /e-?mail/i.test(k))?.[1] || '');
    const hasWebsite = website.trim().length > 0;

    const prompt = `You are a sales research analyst for a B2B digital agency. Your job is to deeply analyze each business and generate UNIQUE, SPECIFIC sales intelligence. Do NOT give generic advice.

=== BUSINESS DATA ===
Company: ${lead.firm_name || 'Unknown'}
Contact: ${lead.contact_person || 'Unknown'}
Website: ${hasWebsite ? website : 'NO WEBSITE FOUND'}
Industry/Capabilities: ${capabilities || 'Not provided'}
Location: ${address || 'Not provided'}
Email: ${email || 'Not provided'}
All Data:
${businessInfo}

=== YOUR TASK ===
1. Analyze what this SPECIFIC business does (e.g., "${lead.firm_name}" — what is their industry? what do they sell/provide?)
2. Based on THEIR industry and services, determine what digital services would actually help THEM
3. Write talking points that reference THEIR specific business, industry terms, and pain points

Respond in this exact JSON format only, no markdown:
{
  "what_to_offer": ["service1", "service2"],
  "talking_points": [
    "point1",
    "point2",
    "point3",
    "point4"
  ]
}

=== STRICT RULES ===
- what_to_offer: Pick 2-4 services ONLY from: Website, Website Redesign, Local SEO, Google Business, Social Media, PPC Ads, E-commerce, Branding, Content Marketing, Email Marketing, CRM Setup
- IMPORTANT: Choose services that make sense for THIS business type. A metal supplier needs different things than a restaurant.
${!hasWebsite ? '- This business has NO WEBSITE — this is the #1 priority. Lead with that.' : '- They have a website — suggest improvements, SEO, or complementary services.'}
- talking_points: Write 3-5 points that are SPECIFIC to "${lead.firm_name}".
  - MENTION their actual business type/industry (e.g., "${capabilities ? capabilities.substring(0, 50) : 'their services'}")
  - MENTION their location if available for local SEO angles
  - Reference specific pain points for THEIR industry, not generic digital marketing advice
  - Each point must be different — don't repeat the same idea in different words
- Keep each talking point under 120 characters
- Do NOT use generic phrases like "enhance your online presence" or "attract more clients" — be SPECIFIC about WHY and HOW`;

    // Call OpenAI
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
        max_tokens: 500,
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
      // Handle potential markdown code blocks
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error('Failed to parse GPT response:', content);
      return NextResponse.json(
        { status: 'error', message: 'Failed to parse AI response' },
        { status: 500 }
      );
    }

    // Save to database
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

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';
import { scrapeBusinessForEnrichment, ScrapedBusinessData } from '@/lib/scrapers/scraping-service';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'info@bytesplatform.com';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * POST /api/agent/dialer-leads/send-email
 * Agent clicks "Send Email" during a call → generates personalized email via GPT → sends via SendGrid
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwt = payload as unknown as JwtPayload;

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ status: 'error', message: 'OpenAI API key not configured' }, { status: 500 });
    }
    if (!SENDGRID_API_KEY) {
      return NextResponse.json({ status: 'error', message: 'SendGrid API key not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { lead_id } = body;

    if (!lead_id) {
      return NextResponse.json({ status: 'error', message: 'lead_id is required' }, { status: 400 });
    }

    // 2. Fetch lead
    const lead = await queryOne<any>(
      `SELECT id, firm_name, contact_person, phone_number, raw_data, what_to_offer, talking_points, ai_generated, email_sent, state, scraped_data
       FROM dialer_leads WHERE id = $1`,
      [lead_id]
    );

    if (!lead) {
      return NextResponse.json({ status: 'error', message: 'Lead not found' }, { status: 404 });
    }

    if (lead.email_sent) {
      return NextResponse.json({ status: 'error', message: 'Email already sent to this lead' }, { status: 400 });
    }

    const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;

    // 3. Find recipient email from raw_data
    const emailEntry = Object.entries(rawData).find(([k]) => /e-?mail/i.test(k));
    const recipientEmail = emailEntry ? String(emailEntry[1]).trim() : '';

    if (!recipientEmail || !recipientEmail.includes('@')) {
      return NextResponse.json({ status: 'error', message: 'No valid email address found for this lead' }, { status: 400 });
    }

    // 4. Get agent name + email for FROM address (email_name > username, email_address > SENDER_EMAIL)
    const agent = await queryOne<{ username: string; email_name: string | null; email_address: string | null }>('SELECT username, email_name, email_address FROM users WHERE id = $1', [Number(jwt.userId)]);
    const agentName = agent?.email_name || agent?.username || 'Bytes Platform Team';
    const agentEmail = agent?.email_address || SENDER_EMAIL;

    // 5. Extract business info from raw_data
    const website = String(Object.entries(rawData).find(([k]) => /www|url|website/i.test(k))?.[1] || '');
    const capabilities = String(Object.entries(rawData).find(([k]) => /capabilities|narrative|description|business/i.test(k))?.[1] || '');
    const address = String(Object.entries(rawData).find(([k]) => /address|city|location/i.test(k))?.[1] || '');
    const stateField = String(Object.entries(rawData).find(([k]) => /^state$/i.test(k))?.[1] || lead.state || '');
    const zipField = String(Object.entries(rawData).find(([k]) => /zip|postal/i.test(k))?.[1] || '');

    // 6. Clean business name and zip for search
    const cleanBusinessName = (lead.firm_name || '')
      .replace(/\*[^*]*\*/g, '')
      .replace(/[^\w\s&.,'-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cleanZip = zipField.trim().replace(/\.0$/, '');

    let scrapedData: ScrapedBusinessData;

    if (lead.scraped_data) {
      console.log(`[SEND-EMAIL] Using cached scraped data for lead ${lead_id}`);
      scrapedData = lead.scraped_data as ScrapedBusinessData;
    } else {
      console.log(`[SEND-EMAIL] Scraping for lead ${lead_id}: ${cleanBusinessName || lead.firm_name}`);
      try {
        scrapedData = await scrapeBusinessForEnrichment({
          website: website.trim() || undefined,
          email: recipientEmail || undefined,
          businessName: cleanBusinessName || undefined,
          state: stateField.trim() || undefined,
          zipCode: cleanZip || undefined,
        });
      } catch (scrapeError: any) {
        console.error(`[SEND-EMAIL] Scraping failed:`, scrapeError.message);
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
    }

    // 7. Build scraped content section for GPT (exact format from email-backend)
    const formatScrapedDetails = () => {
      if (!scrapedData.scrapeSuccess) return 'No scraped data available';
      const details: string[] = [];
      if (scrapedData.pageTitle) details.push(`Page Title: ${scrapedData.pageTitle}`);
      if (scrapedData.metaDescription) details.push(`Meta Description: ${scrapedData.metaDescription}`);
      if (scrapedData.homepageText) details.push(`Homepage Content: ${scrapedData.homepageText.substring(0, 1500)}${scrapedData.homepageText.length > 1500 ? '...' : ''}`);
      if (scrapedData.servicesText) details.push(`Services: ${scrapedData.servicesText.substring(0, 800)}${scrapedData.servicesText.length > 800 ? '...' : ''}`);
      if (scrapedData.productsText) details.push(`Products: ${scrapedData.productsText.substring(0, 800)}${scrapedData.productsText.length > 800 ? '...' : ''}`);
      if (scrapedData.solutionsText) details.push(`Solutions: ${scrapedData.solutionsText.substring(0, 500)}${scrapedData.solutionsText.length > 500 ? '...' : ''}`);
      if (scrapedData.featuresText) details.push(`Features: ${scrapedData.featuresText.substring(0, 500)}${scrapedData.featuresText.length > 500 ? '...' : ''}`);
      if (scrapedData.blogText) details.push(`Blog: ${scrapedData.blogText.substring(0, 300)}${scrapedData.blogText.length > 300 ? '...' : ''}`);
      if (scrapedData.extractedEmails?.length > 0) details.push(`Contact Emails: ${scrapedData.extractedEmails.join(', ')}`);
      if (scrapedData.extractedPhones?.length > 0) details.push(`Contact Phones: ${scrapedData.extractedPhones.join(', ')}`);
      return details.length > 0 ? details.join('\n') : 'Limited scraped data available';
    };
    const scrapedDetails = formatScrapedDetails();

    const businessInfo = Object.entries(rawData)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    // 8. Build email generation prompt — EXACT copy from email-backend-second-prompt,
    //    only adapted: "I came across today" → "It was great speaking with you just now" for on-call context
    const contactBizName = lead.firm_name || 'there';
    const contactPerson = lead.contact_person || contactBizName;

    const prompt = `
You are a B2B outreach specialist writing a follow-up email for Bytes Platform.
The sales agent is CURRENTLY ON THE PHONE with this person and said "I'll send you an email."
Your only job is to write an email that sounds EXACTLY like the gold standard below. Read it three times before writing anything.

════════════════════════════════════════════════
GOLD STANDARD EMAIL — THIS IS YOUR ONLY TEMPLATE
════════════════════════════════════════════════

Subject: A thought on growing Mackie Mobile

Hi [Name],

It was great speaking with you just now. I'm ${agentName} from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation. I have to say, being the first privacy-first wireless carrier is a genuinely bold move, and the market clearly needs it.

The thing that stood out to me is that people who are actively looking for a private, secure wireless alternative are out there searching right now. SIM swap fraud and phishing attacks are in the news constantly, and privacy-conscious consumers are becoming more common every day. The question is whether they're finding Mackie Mobile when they search.

An SEO strategy built around the exact terms your ideal customers are searching, combined with some process automation to make onboarding and support smoother as you grow, could really accelerate things for you.

As I mentioned on the call, I'd love to share a couple of ideas I had specifically for Mackie. Would a 15-minute follow-up call this week work? You can {{BOOKING_LINK}} here.

Best regards,
${agentName}

════════════════════════════════════════════════
PARAGRAPH STRUCTURE — STUDY THIS CAREFULLY
════════════════════════════════════════════════

PARAGRAPH 1 = Warm Opening + Introduction + Compliment BLENDED TOGETHER
——————————————————————————————————————————————————————
This is ONE paragraph. It has three parts that flow into each other:

PART A — Call reference (always the same, word for word):
"It was great speaking with you just now."

PART B — Who we are (always the same, word for word):
"I'm ${agentName} from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation."

PART C — Immediately continues in the SAME paragraph with a genuine compliment about the target business:
"I have to say, [ONE specific real thing about their business that is genuinely interesting]."

These three parts are ONE paragraph. No line break between them.
The intro and the compliment are never separated.

PARAGRAPH 2 = Real World Market Tension
——————————————————————————————————————————————————————
This stands alone as its own paragraph.
It describes what is happening RIGHT NOW in the world that makes their situation urgent — a real trend, a real problem their customers face, news happening today.
It is NOT "many companies struggle with X."
It ends with a soft tension line that makes them think "yes, that is exactly our reality."
2-3 sentences.

PARAGRAPH 3 = Solution — One Flowing Sentence
——————————————————————————————————————————————————————
ONE paragraph. No bullets. No sub-headers.
Covers GROWTH first (SEO, digital marketing, visibility) then EFFICIENCY second (automation, CRM, workflows).
Specific to their industry.
Ends naturally — no tagline.
Think of Paragraph 3 like this — say it in as few words as possible
while still covering both growth and efficiency.
Less is more here.

PARAGRAPH 4 = Soft Close (reference the call)
——————————————————————————————————————————————————————
Exactly 3 sentences.
Sentence 1: "As I mentioned on the call, I'd love to share a couple of ideas I had specifically for [Business short name]."
Sentence 2: Ask for a 15-minute follow-up call this week (end with question mark).
Sentence 3: "You can {{BOOKING_LINK}} here."

Sign off: "Best regards,\\n${agentName}"

════════════════════════════════════════════════
TARGET BUSINESS INFORMATION
════════════════════════════════════════════════

TARGET BUSINESS: ${contactBizName}
CONTACT PERSON: ${contactPerson}
WEBSITE: ${website || scrapedData.url || 'Not provided'}
LOCATION: ${address || stateField || 'Not specified'}

WEBSITE CONTENT:
${scrapedDetails}

RAW CSV DATA:
${businessInfo}

BYTES PLATFORM SERVICES:
- Web Development
- WordPress Development
- Shopify Development
- MERN Stack Development
- UI/UX Design
- Mobile App Development (iOS & Android)
- Custom Software Development
- AI Applications
- AI Integrations
- Artificial Intelligence & Machine Learning
- Personalized AI Chatbots
- Business Process Automation
- Search Engine Optimization (SEO)
- Social Media Marketing
- Social Media Management
- Data Analytics & Business Intelligence
- Cloud Computing Services
- Cloud Integration
- CRM Development & Integration
- ERP Solutions
- Cybersecurity Solutions
- Blockchain Development

════════════════════════════════════════════════
STEP 0 — COMPETITOR DETECTION (do this first)
════════════════════════════════════════════════

Does this business offer ANY of these as their OWN services?
- Software / app / web / mobile development
- UI/UX or product design
- AI, ML, chatbot development
- Business process or workflow automation
- SEO, social media, or digital marketing
- Data analytics or business intelligence
- Cloud computing or infrastructure
- CRM, ERP, or enterprise software
- Cybersecurity or IT security
- Blockchain or Web3

YES to any → isCompetitor = true
NO to all → isCompetitor = false

════════════════════════════════════════════════
STEP 1 — ANSWER THESE BEFORE WRITING ANYTHING
════════════════════════════════════════════════

Q1. What does this business actually do in plain English?
    One sentence. Not their tagline.
    WRONG: "They provide innovative security solutions"
    RIGHT: "They install video surveillance and access control systems for commercial buildings"

Q2. What is ONE specific real thing on their website that is genuinely interesting — not generic, not their tagline?
    Something a real person would notice while browsing.
    WRONG: "impressive lineup of services"
    WRONG: "cutting-edge technology"
    RIGHT: "They offer 24/7 remote monitoring for multi-site commercial properties with zero-lag cameras"

Q3. What is happening RIGHT NOW in the real world that makes their customers' situation urgent?
    A real trend. A real news item. A real market shift.
    WRONG: "Many companies struggle to integrate systems"
    WRONG: "In a competitive landscape businesses face challenges"
    RIGHT: "Commercial break-ins are rising and business owners are moving from traditional alarms to AI-monitored video — the demand is shifting fast"

Q4. What is the most specific growth thing AND the most specific efficiency thing Bytes Platform can do for THIS business?
    Be specific to their industry, not generic.

Use Q1-Q4 answers to write the email.
If Q2 has no real answer from the website → put "INSUFFICIENT_DATA" in the icebreaker field and stop.

════════════════════════════════════════════════
STEP 2 — WRITE THE EMAIL
════════════════════════════════════════════════

PARAGRAPH 1 RULES — CRITICAL:
Write PART A + PART B + PART C as ONE single paragraph, no line break.

PART A (exact, word for word, every time, no changes):
"It was great speaking with you just now."

PART B (exact, word for word, every time, no changes):
"I'm ${agentName} from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation."

PART C (immediately continues in same paragraph):
Use one of these openers, rotate each time never repeat:
- "I have to say, [compliment]."
- "I was looking at your website and I have to say, [compliment]."
- "Honestly, ${contactBizName} caught my attention because [compliment]."
- "${contactBizName} stood out to me — [compliment]."

The compliment must:
- Come from your Q2 answer — specific and real
- Be genuinely interesting, not generic praise
- End the paragraph naturally

BANNED in Paragraph 1 compliment:
"impressive"
"cutting-edge"
"robust"
"innovative"
"seamlessly"
Any version of their own tagline or mission statement

——————————————————————————————————————————————
PARAGRAPH 2 RULES:
——————————————————————————————————————————————
Standalone paragraph. 3-4 sentences.
Use your Q3 answer — what is happening in the world RIGHT NOW.
Start with "The thing that stood out to me is..." or a natural variation.
End with a soft tension question like:
"The question is whether [their customers] are finding [Business Name] when they search."
or a natural variation that creates the same tension.

BANNED in Paragraph 2:
"currently many companies face"
"in a competitive landscape"
"many businesses struggle"
"it's clear that your focus"
"actionable insights"
"strategic initiatives"
"robust"
"seamlessly"
"cutting-edge"

——————————————————————————————————————————————
PARAGRAPH 3 RULES:
——————————————————————————————————————————————
One flowing paragraph. No bullets. No line breaks inside.
Growth mechanism + outcome → then → Efficiency mechanism + outcome.
Specific to their industry from Q4.
End naturally. No tagline. No "helping you grow faster while..."
Think of Paragraph 3 like this — say it in as few words as possible
while still covering both growth and efficiency.
Less is more here.

——————————————————————————————————————————————
PARAGRAPH 4 RULES:
——————————————————————————————————————————————
Exactly 3 sentences.
"As I mentioned on the call, I'd love to share a couple of ideas I had specifically for [Business short name]."
Then ask for a 15-minute follow-up call this week (end with question mark).
Then add: "You can {{BOOKING_LINK}} here."

════════════════════════════════════════════════
IF isCompetitor = true
════════════════════════════════════════════════

Same 4-paragraph structure. Same tone. Same banned words.
Paragraph 3 only: do NOT pitch dev, AI, automation, or cybersecurity as if they lack it.
Only pitch: SEO, social media, marketing automation, CRM pipeline, or business intelligence.
Language: "work alongside", "expand reach", "grow together"
Never imply missing capability.

════════════════════════════════════════════════
SUBJECT LINE RULES
════════════════════════════════════════════════

The gold standard subject is: "A thought on growing Mackie Mobile"
Study WHY it works: personal, includes business name, sounds like a human thought, creates curiosity.

3 subject lines. Each MUST include the business name or owner's first name.
Each a completely different angle:
Subject 1 — a thought or idea for their business (like gold standard)
Subject 2 — a genuine real observation about their business
Subject 3 — a curiosity question about their growth

GOOD examples:
- "A thought on growing [Business]"
- "Quick idea for [Business] after our call"
- "Something I noticed about [Business]"
- "[Name], a question about [industry topic]"
- "Following up on [Business]"

BAD examples (too generic, no business name):
- "Rising demand for secure website solutions"
- "Staying Ahead in Digital Transformation"
- "Growing Your Online Presence"
- "Thoughts on your business strategy"

Rules:
- No emojis. No exclamation marks.
- Under 9 words each.
- MUST include the actual business name or contact's first name.
- Must sound personal, like a human wrote it — not like a marketing newsletter.
- Each one must make someone want to open.

════════════════════════════════════════════════
ICEBREAKER
════════════════════════════════════════════════

One sentence. 25-35 words.
Sounds like something said on a real sales call.
Specific real insight from their website.
Sharp enough to stop someone mid-scroll.

════════════════════════════════════════════════
OUTPUT — valid JSON only, no markdown, nothing else
════════════════════════════════════════════════

{
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Hi ${contactPerson},\\n\\nIt was great speaking with you just now. I'm ${agentName} from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation. [PART C compliment here].\\n\\n[Paragraph 2]\\n\\n[Paragraph 3]\\n\\nAs I mentioned on the call...\\n\\nBest regards,\\n${agentName}",
  "icebreaker": "One sentence 25-35 words",
  "rationale": "Brief mapping of pain points to growth and efficiency"
}

CRITICAL JSON RULES:
- Use \\n for line breaks inside emailBody
- Escape all quotes with \\"
- Must be 100% JSON.parse() valid
- Output ONLY the JSON — nothing before or after
- Email must be 100-150 words (concise, not long)
- Address the email to "${contactPerson}" not the business name`;

    // 9. Call GPT
    console.log(`[SEND-EMAIL] Generating email via GPT for lead ${lead_id}`);
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
        max_tokens: 2000,
      }),
    });

    if (!gptResponse.ok) {
      const err = await gptResponse.text();
      console.error('[SEND-EMAIL] OpenAI error:', err);
      return NextResponse.json({ status: 'error', message: 'Failed to generate email content' }, { status: 500 });
    }

    const gptData = await gptResponse.json();
    const content = gptData.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json({ status: 'error', message: 'Empty GPT response' }, { status: 500 });
    }

    // 10. Parse GPT response
    let parsed: { subjectLines: string[]; emailBody: string; icebreaker: string };
    try {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanContent);
    } catch (parseErr) {
      console.error('[SEND-EMAIL] Failed to parse GPT response:', content);
      return NextResponse.json({ status: 'error', message: 'Failed to parse email content' }, { status: 500 });
    }

    // Post-process: replace placeholders (same as email-backend lines 216-220)
    let emailBody = parsed.emailBody
      .replace(/\[Your Name\]/g, agentName)
      .replace(/\[your name\]/gi, agentName)
      .replace(/^Hi there,/m, `Hi ${contactPerson},`)
      .replace(/\{\{BOOKING_LINK\}\}/g, 'Book a Meeting (https://calendly.com/bytesplatform/new-meeting-1)');

    const subject = `${contactBizName} - Bytes Platform`;

    // 11. Convert to HTML + inject signature
    const emailHtml = buildEmailHtml(emailBody, agentName);

    // 12. Send via SendGrid
    console.log(`[SEND-EMAIL] Sending to ${recipientEmail} via SendGrid`);
    const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: recipientEmail }], subject }],
        from: { email: agentEmail, name: agentName },
        content: [{ type: 'text/html', value: emailHtml }],
        tracking_settings: {
          open_tracking: { enable: true },
          click_tracking: { enable: true, enable_text: true },
        },
      }),
    });

    if (!sgResponse.ok) {
      const sgErr = await sgResponse.text();
      console.error('[SEND-EMAIL] SendGrid error:', sgErr);
      return NextResponse.json({ status: 'error', message: 'Failed to send email via SendGrid' }, { status: 500 });
    }

    const messageId = sgResponse.headers.get('x-message-id') || `sg_${Date.now()}`;

    // 13. Log email + mark lead as email_sent
    await query(
      `INSERT INTO dialer_email_logs (lead_id, agent_id, recipient_email, subject, body_html, sendgrid_message_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [lead_id, Number(jwt.userId), recipientEmail, subject, emailHtml, messageId]
    );

    await queryOne(
      `UPDATE dialer_leads SET email_sent = true, email_sent_at = NOW() WHERE id = $1`,
      [lead_id]
    );

    console.log(`[SEND-EMAIL] ✅ Email sent to ${recipientEmail} for lead ${lead_id} (msgId: ${messageId})`);

    return NextResponse.json({
      status: 'success',
      message: `Email sent to ${recipientEmail}`,
      data: {
        recipient: recipientEmail,
        subject,
        message_id: messageId,
      },
    });

  } catch (error) {
    console.error('[SEND-EMAIL] Error:', error);
    return NextResponse.json({ status: 'error', message: 'Failed to send email' }, { status: 500 });
  }
}


/**
 * Convert plain text email body to HTML with Bytes Platform signature.
 * Ported from email-backend SendGridService.
 */
function buildEmailHtml(bodyText: string, senderName: string): string {
  // GPT returns literal \n in JSON strings — convert to real newlines first
  const normalized = bodyText.replace(/\\n/g, '\n');

  // Split on double newlines into paragraphs
  const paragraphs = normalized.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  const htmlParagraphs = paragraphs.map(paragraph => {
    // Replace booking link text with styled hyperlink
    let processed = paragraph.replace(
      /Book a Meeting \(https:\/\/calendly\.com\/bytesplatform\/new-meeting-1\)/g,
      '<a href="https://calendly.com/bytesplatform/new-meeting-1" style="color: #0066cc; text-decoration: none; font-weight: bold;">Book a Meeting</a>'
    );

    const withBreaks = processed
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('<br>');

    return `<p style="margin: 0 0 16px 0; line-height: 1.6; color: #333;">${withBreaks}</p>`;
  });

  const logoUrl = 'https://jgvyyymd0liffl4w.public.blob.vercel-storage.com/Logo%20%282%29.png';

  const signature = `
<div id="bytes-email-signature" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333;">
  <p style="margin: 0 0 12px 0; font-size: 16px; font-weight: bold; color: #1a1a1a;">Bytes Platform</p>
  <p style="margin: 0 0 8px 0; font-size: 13px; color: #555;">Helping businesses scale with modern digital solutions</p>
  <div style="margin-top: 10px; font-size: 13px; color: #555;">
    <p style="margin: 2px 0;">&#127760; <a href="https://bytesplatform.com/" style="color: #0066cc; text-decoration: none;">bytesplatform.com</a></p>
    <p style="margin: 2px 0;">&#128231; <a href="mailto:info@bytesplatform.com" style="color: #0066cc; text-decoration: none;">info@bytesplatform.com</a></p>
    <p style="margin: 2px 0;">&#128222; <a href="tel:8333230371" style="color: #0066cc; text-decoration: none;">833-323-0371</a> (Toll Free)</p>
    <p style="margin: 2px 0;">&#128222; <a href="tel:9457230190" style="color: #0066cc; text-decoration: none;">945-723-0190</a> (Direct Line)</p>
  </div>
  <div style="margin-top: 12px;">
    <img src="${logoUrl}" alt="Bytesplatform" style="max-width: 150px; height: auto;" />
  </div>
</div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${htmlParagraphs.join('')}
  ${signature}
</body>
</html>`;
}

/**
 * C3.2 classification rubric + decision tree, and the C1.2 / C3.3 keyword
 * lookup used as the no-AI pitch generator (E.7 fallback).
 */

export type Service = 'website_new' | 'revamp' | 'seo' | 'smm' | 'automation' | 'contract_mgmt' | 'exit';

export const SERVICE_LABELS: Record<Service, string> = {
  website_new: 'New website (+ capability statement page)',
  revamp: 'Website revamp',
  seo: 'SEO (3 or 6 months)',
  smm: 'Social media marketing',
  automation: 'Automation / custom build / AI receptionist',
  contract_mgmt: 'Contract-management build (Bytescon)',
  exit: 'Not a fit — polite exit',
};

export type Flag =
  | 'no_site' | 'no_ssl' | 'old_copyright' | 'not_mobile' | 'no_capability_statement' | 'no_social'
  | 'no_blog' | 'template_look' | 'slow_load' | 'no_contact_form' | 'modern_site' | 'bids_often'
  | 'bd_staff' | 'hiring' | 'missed_calls_pain' | 'ops_volume' | 'private_customers' | 'pure_federal';

type Scores = Record<Exclude<Service, 'exit'>, number>;

// Points per signal (C3.2 Step 2). Columns: website_new, revamp, seo, smm, automation, contract_mgmt.
const SIGNAL_POINTS: Partial<Record<Flag | 'outdated', Partial<Scores>>> = {
  no_site: { website_new: 5 },
  outdated: { revamp: 4, seo: 1 },
  no_capability_statement: { website_new: 1, revamp: 2, contract_mgmt: 1 },
  private_customers: { seo: 3, smm: 2, automation: 1 },
  no_blog: { seo: 2 },
  no_social: { smm: 2 },
  hiring: { smm: 2, automation: 1 },
  missed_calls_pain: { automation: 4 },
  ops_volume: { automation: 2 },
  bids_often: { contract_mgmt: 4 },
  bd_staff: { contract_mgmt: 2 },
  pure_federal: { website_new: 1, revamp: 1, seo: -3, smm: -2, contract_mgmt: 2 },
};

const OUTDATED_FLAGS: Flag[] = ['no_ssl', 'old_copyright', 'not_mobile', 'template_look'];

export interface Classification {
  scores: Scores;
  lead: Service;
  runner_up: Service | null;
  path: string[];
  reason: string;
}

export function classify(flagsIn: string[]): Classification {
  const flags = new Set(flagsIn as Flag[]);
  const scores: Scores = { website_new: 0, revamp: 0, seo: 0, smm: 0, automation: 0, contract_mgmt: 0 };
  const add = (p?: Partial<Scores>) => {
    for (const [k, v] of Object.entries(p || {})) scores[k as keyof Scores] += v as number;
  };

  const outdated = OUTDATED_FLAGS.some((f) => flags.has(f));
  for (const f of Array.from(flags)) {
    // A decent site with no blog only counts when it isn't outdated.
    if (f === 'no_blog' && outdated) continue;
    add(SIGNAL_POINTS[f]);
  }
  if (outdated && !flags.has('no_site')) add(SIGNAL_POINTS.outdated);

  // Decision tree (quick version) gives the lead; scores break ties / runner-up.
  const path: string[] = [];
  let lead: Service;
  if (flags.has('no_site')) {
    path.push('No working website');
    lead = 'website_new';
  } else if (outdated || flags.has('no_capability_statement')) {
    path.push('Website exists', 'Outdated (no SSL / old © / not mobile / no capability statement)');
    lead = 'revamp';
  } else if (flags.has('bids_often') || flags.has('bd_staff')) {
    path.push('Website is solid', 'Bids on many solicitations / has a BD function');
    lead = 'contract_mgmt';
  } else if (flags.has('private_customers') && !flags.has('pure_federal')) {
    path.push('Website is solid', 'Not a heavy bidder', 'Has private/local customers');
    if (flags.has('missed_calls_pain') || flags.has('ops_volume')) {
      path.push('Missed calls / scheduling pain');
      lead = 'automation';
    } else if (flags.has('no_blog') || !flags.has('modern_site')) {
      path.push('Invisible on Google');
      lead = 'seo';
    } else if (flags.has('no_social') || flags.has('hiring')) {
      path.push('Inactive socials / hiring');
      lead = 'smm';
    } else {
      lead = 'seo';
    }
  } else {
    path.push('Website is solid', 'Pure federal');
    if (flags.has('missed_calls_pain') || flags.has('ops_volume')) {
      path.push('Ops pain');
      lead = 'automation';
    } else {
      path.push('No clear pain');
      lead = 'exit';
    }
  }

  const ranked = (Object.entries(scores) as [keyof Scores, number][])
    .sort((a, b) => b[1] - a[1])
    .filter(([s, v]) => s !== lead && v > 0);
  const runner_up = ranked[0]?.[0] ?? null;

  return {
    scores,
    lead,
    runner_up,
    path,
    reason: `${path.join(' → ')} → lead with ${SERVICE_LABELS[lead]}${runner_up ? `; keep ${SERVICE_LABELS[runner_up]} as the "and also"` : ''}.`,
  };
}

// ------------------------------------------------------------------ keyword pitch lookup (no-AI)

interface IndustryTemplate {
  key: string;
  match: RegExp;
  industry: string;
  size_guess: string;
  gov_mix: 'pure_federal' | 'mixed' | 'commercial';
  pains: string[];
  look_for: string;
  inferred_flags: Flag[];
  talking_points: string[];
  first_question: string;
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    key: 'guards', match: /security (officer|guard)|armed|unarmed|guard service|patrol/i,
    industry: 'Guard services', size_guess: '10–200 staff, many part-time', gov_mix: 'mixed',
    pains: ['Hiring guards', 'Scheduling shifts', 'Winning commercial clients', 'Compliance paperwork'],
    look_for: 'Hiring page? Social links? Commercial clients?',
    inferred_flags: ['private_customers', 'hiring'],
    talking_points: [
      'Guard companies tell us hiring reliable officers is the biggest headache.',
      'Winning private clients beyond government work — is that a priority?',
      'Missed shift check-ins can trigger an automatic text to a supervisor.',
    ],
    first_question: "Which one's bigger for you right now: finding reliable officers or winning private clients?",
  },
  {
    key: 'aerospace', match: /aircraft|aerospace|\bcls\b|depot maintenance|logistics support|avionics/i,
    industry: 'Aerospace maintenance (CLS = contractor logistics support)', size_guess: 'Specialized, often 20–500', gov_mix: 'pure_federal',
    pains: ['Credibility with primes', 'Bids/proposals', 'Compliance', 'Tracking deliverables'],
    look_for: 'Capability statement, CAGE/NAICS, past performance, modern look; bid volume',
    inferred_flags: ['pure_federal'],
    talking_points: [
      'Maintenance contractors on DoD programs often chase solicitations by hand.',
      'Building compliance checklists from 60-page solicitations takes days.',
      'Primes check your site and capability statement before calling back.',
    ],
    first_question: 'How is your team finding and tracking new solicitations today?',
  },
  {
    key: 'lockers', match: /locker|shelving|bench|storage|furniture/i,
    industry: 'Furniture/storage supplier or reseller', size_guess: 'Small reseller or distributor', gov_mix: 'mixed',
    pains: ['Quote requests', 'Catalog online', 'Findability by facility managers'],
    look_for: 'Online catalog? Quote form? Product photos? Mobile?',
    inferred_flags: ['private_customers'],
    talking_points: [
      'Facility managers want to see products and request a quote on the spot.',
      'An online catalog with a quote form turns visits into requests.',
      'Are quote requests coming through the site today?',
    ],
    first_question: 'When a facility manager wants lockers, how do they usually reach you?',
  },
  {
    key: 'lab', match: /\blab\b|laborator|forensic|environmental test|testing lab|analytical/i,
    industry: 'Lab services', size_guess: '5–50', gov_mix: 'mixed',
    pains: ['Sample intake & tracking', 'Client portal', 'Accreditation display', 'Commercial clients'],
    look_for: 'Accreditations shown? Sample submission info? Client portal?',
    inferred_flags: ['private_customers', 'ops_volume'],
    talking_points: [
      'Labs lose hours to sample intake and chain-of-custody paperwork.',
      '"Is my report ready?" calls can be answered by a client portal.',
      'Showing accreditations up front builds trust with new clients.',
    ],
    first_question: 'How are you handling sample intake today: spreadsheets, a LIMS, something else?',
  },
  {
    key: 'electrical', match: /electric/i,
    industry: 'Electrical contractor', size_guess: '5–100', gov_mix: 'mixed',
    pains: ['Commercial/residential leads', 'Bidding', 'Crew scheduling', 'Google visibility'],
    look_for: 'Project gallery, service area pages, reviews, mobile',
    inferred_flags: ['private_customers'],
    talking_points: [
      'When a GC searches for a commercial electrician, the top three get most calls.',
      'Service-area pages and reviews help you show up locally.',
      'Do you know where you show up on Google today?',
    ],
    first_question: 'Where do your commercial customers come from today?',
  },
  {
    key: 'fasteners', match: /fastener|industrial supply|distribut|hardware|mro/i,
    industry: 'Distributor', size_guess: '5–50', gov_mix: 'mixed',
    pains: ['Quote handling', 'Inventory', 'Online catalog', 'Repeat orders'],
    look_for: 'Line card/catalog, RFQ form, ordering',
    inferred_flags: ['ops_volume'],
    talking_points: [
      'Distributors get RFQs by phone, email and fax — some fall through the cracks.',
      'An online line card and RFQ form makes repeat orders easier.',
      'Quote tracking can be automated so nothing gets missed.',
    ],
    first_question: 'How are you keeping track of RFQs today?',
  },
  {
    key: 'radio', match: /radio|tower|telecom|communications|two-way|2-way/i,
    industry: 'Telecom/communications', size_guess: '5–50', gov_mix: 'mixed',
    pains: ['Project tracking', 'Credibility', 'Regional commercial clients'],
    look_for: 'Projects, certifications, coverage area, last update',
    inferred_flags: [],
    talking_points: [
      'Primes check tower and radio firms’ websites before calling back.',
      'Is your site showing the projects you’ve actually done?',
      'A simple project tracker keeps crews and deadlines in one place.',
    ],
    first_question: 'Is your website showing the projects you’ve actually done?',
  },
  {
    key: 'hvac', match: /hvac|duct|air condition|heating|plumb|cleaning/i,
    industry: 'Home/commercial services', size_guess: '3–30', gov_mix: 'commercial',
    pains: ['Local leads', 'Reviews', 'Missed calls', 'Appointment booking', 'Seasonal demand'],
    look_for: 'Reviews, booking button, service pages, Google presence, socials',
    inferred_flags: ['private_customers', 'missed_calls_pain'],
    talking_points: [
      'In HVAC and duct cleaning, the company that answers first usually gets the job.',
      'An AI receptionist answers after-hours calls and books the appointment.',
      'Showing up for "[service] [city]" searches brings local jobs.',
    ],
    first_question: 'What happens today when someone calls you at 7 p.m. or on a Saturday?',
  },
  {
    key: 'integrator', match: /cctv|access control|surveillance|alarm|integrat|low voltage/i,
    industry: 'Security systems integrator', size_guess: '5–50', gov_mix: 'mixed',
    pains: ['Commercial leads', 'Quoting', 'Service contracts', 'Project management'],
    look_for: 'Case studies, manufacturer certifications, service contracts',
    inferred_flags: ['private_customers'],
    talking_points: [
      'Integrators juggle bids, installs and service contracts all at once.',
      'Case studies and certifications on the site win commercial trust.',
      'A CRM keeps service-contract renewals from slipping.',
    ],
    first_question: 'Where’s the bigger bottleneck: getting new projects or tracking the ones you have?',
  },
];

const BID_SIGNALS = /\b(idiq|gsa|seaport|sewp|oasis|8\(a\)|hubzone|sdvosb|wosb|cage|past performance|task order|prime contractor|subcontract|army|navy|air force|dod|dla|nasa|va\b|dhs)\b/gi;

/** E.7 fallback: talking points + likely service from the narrative alone. */
export function keywordPitch(narrative: string, scanFlags: string[] = []) {
  const text = String(narrative || '');
  const template = INDUSTRY_TEMPLATES.find((t) => t.match.test(text));
  const flags = new Set<string>([...(template?.inferred_flags || []), ...scanFlags]);

  // C1.2 size rule of thumb: many agencies/vehicles/certs → larger, bids often.
  const bidHits = new Set((text.match(BID_SIGNALS) || []).map((s) => s.toLowerCase())).size;
  if (bidHits >= 3 || text.length > 600) flags.add('bids_often');
  const shortAllCaps = text.length < 160 && text === text.toUpperCase();
  const sizeGuess = shortAllCaps ? 'Small reseller (short ALL-CAPS product list)' : bidHits >= 3 ? 'Larger, more sophisticated (lists agencies/vehicles)' : template?.size_guess || 'Unknown';

  const c = classify(Array.from(flags));
  return {
    industry: template?.industry || 'Government contractor (industry unclear)',
    size_guess: sizeGuess,
    gov_mix_guess: template?.gov_mix || (flags.has('pure_federal') ? 'pure_federal' : 'unknown — ask "What % of your work is government vs. private?"'),
    lead_service: c.lead,
    runner_up_service: c.runner_up,
    talking_points: template?.talking_points || [
      'We work with contractors registered on SAM.gov in your industry.',
      'When a prime or CO looks you up, what do they find?',
      'Is your website bringing in any work, or is it more of a business card?',
    ],
    first_question: template?.first_question || 'What % of your work is government vs. private/commercial?',
    reason: c.reason,
    look_for: template?.look_for || 'Padlock, © year, mobile, capability statement/NAICS, socials, contact form',
    pains: template?.pains || [],
    flags: Array.from(flags),
  };
}

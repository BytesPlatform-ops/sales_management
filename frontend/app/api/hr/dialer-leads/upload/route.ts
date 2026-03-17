import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query, queryOne } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * POST /api/hr/dialer-leads/upload
 * Upload a CSV file of leads. Parses the 2-row-per-lead format.
 * Stores all columns as JSONB in raw_data + extracts phone/firm/contact.
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

    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    // 2. Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const leadsPerAgent = parseInt(formData.get('leads_per_agent') as string || '200', 10);

    if (!file) {
      return NextResponse.json({ status: 'error', message: 'No file uploaded' }, { status: 400 });
    }

    const csvText = await file.text();
    const leads = parseCSV(csvText);

    if (leads.length === 0) {
      return NextResponse.json({ status: 'error', message: 'No valid leads found in CSV' }, { status: 400 });
    }

    // 3. Create batch record
    const batch = await queryOne<{ id: number }>(
      `INSERT INTO lead_upload_batches (file_name, total_leads, uploaded_by, leads_per_agent)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [file.name, leads.length, jwt.userId, leadsPerAgent]
    );

    if (!batch) {
      return NextResponse.json({ status: 'error', message: 'Failed to create batch' }, { status: 500 });
    }

    // 4. Bulk insert leads
    const CHUNK_SIZE = 100;
    let insertedCount = 0;

    for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
      const chunk = leads.slice(i, i + CHUNK_SIZE);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;

      for (const lead of chunk) {
        placeholders.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        values.push(
          lead.firm_name || null,
          lead.contact_person || null,
          lead.phone_number,
          JSON.stringify(lead.raw_data),
          batch.id
        );
      }

      const result = await query(
        `INSERT INTO dialer_leads (firm_name, contact_person, phone_number, raw_data, batch_id)
         VALUES ${placeholders.join(', ')} RETURNING id`,
        values
      );
      insertedCount += result.length;
    }

    return NextResponse.json({
      status: 'success',
      message: `Uploaded ${insertedCount} leads from "${file.name}"`,
      data: {
        batch_id: batch.id,
        total_leads: insertedCount,
        file_name: file.name,
      },
    });
  } catch (error) {
    console.error('Dialer leads upload error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to upload leads' },
      { status: 500 }
    );
  }
}

/**
 * Parse CSV with flexible column format.
 * Handles the 2-row-per-lead pattern:
 *   Row 1: data (firm, contact, capabilities, email, phone, website)
 *   Row 2: address only (in column D / "Address and City, State Zip")
 *
 * Also handles standard 1-row CSVs where address is on the same row.
 */
function parseCSV(csvText: string): Array<{
  firm_name: string;
  contact_person: string;
  phone_number: string;
  raw_data: Record<string, string>;
}> {
  const lines = parseCSVLines(csvText);
  if (lines.length < 2) return [];

  // Find header row (first row with recognizable headers)
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const row = lines[i];
    const hasPhoneHeader = row.some(cell =>
      cell.toLowerCase().includes('phone')
    );
    const hasFirmHeader = row.some(cell =>
      cell.toLowerCase().includes('firm') || cell.toLowerCase().includes('company') || cell.toLowerCase().includes('business')
    );
    if (hasPhoneHeader || hasFirmHeader) {
      headerIdx = i;
      headers = row.map(h => h.trim());
      break;
    }
  }

  if (headerIdx === -1) {
    // No recognizable headers — use first non-empty row as headers
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].some(cell => cell.trim() !== '')) {
        headerIdx = i;
        headers = lines[i].map(h => h.trim());
        break;
      }
    }
  }

  if (headerIdx === -1) return [];

  // Find which columns map to our core fields
  const phoneCol = findColumn(headers, ['phone number', 'phone', 'tel', 'telephone', 'mobile']);
  const firmCol = findColumn(headers, ['name of firm', 'firm', 'company', 'business name', 'company name']);
  const contactCol = findColumn(headers, ['contact', 'contact person', 'contact name', 'name']);
  const addressCol = findColumn(headers, ['address', 'address and city']);

  // Only the # column should be skipped
  const skipCol = findColumn(headers, ['#']);

  // Parse data rows
  const leads: Array<{
    firm_name: string;
    contact_person: string;
    phone_number: string;
    raw_data: Record<string, string>;
  }> = [];

  let currentLead: {
    firm_name: string;
    contact_person: string;
    phone_number: string;
    raw_data: Record<string, string>;
  } | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = lines[i];
    if (row.every(cell => cell.trim() === '')) continue; // skip empty rows

    const phone = phoneCol !== -1 ? row[phoneCol]?.trim() : '';
    const firm = firmCol !== -1 ? row[firmCol]?.trim() : '';

    // If this row has a phone number or firm name, it's a new lead
    if (phone || firm) {
      // Save previous lead
      if (currentLead && currentLead.phone_number) {
        leads.push(currentLead);
      }

      // Build raw_data from all columns (A-H, skip #)
      const rawData: Record<string, string> = {};
      for (let c = 0; c < headers.length && c < row.length; c++) {
        if (c === skipCol) continue;
        const header = headers[c];
        if (header && row[c]?.trim()) {
          rawData[header] = row[c].trim();
        }
      }

      currentLead = {
        firm_name: firm,
        contact_person: contactCol !== -1 ? row[contactCol]?.trim() || '' : '',
        phone_number: phone,
        raw_data: rawData,
      };
    } else if (currentLead) {
      // This is a continuation row (address row)
      // Merge non-empty cells into raw_data
      for (let c = 0; c < headers.length && c < row.length; c++) {
        if (c === skipCol) continue;
        const header = headers[c];
        const value = row[c]?.trim();
        if (header && value) {
          if (currentLead.raw_data[header]) {
            currentLead.raw_data[header] += ' ' + value;
          } else {
            currentLead.raw_data[header] = value;
          }
        }
      }
    }
  }

  // Don't forget the last lead
  if (currentLead && currentLead.phone_number) {
    leads.push(currentLead);
  }

  return leads;
}

function findColumn(headers: string[], keywords: string[]): number {
  for (const keyword of keywords) {
    const idx = headers.findIndex(h =>
      h.toLowerCase().includes(keyword.toLowerCase())
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse CSV text into rows, handling quoted fields with commas inside.
 */
function parseCSVLines(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  const lines = text.split('\n');

  for (const line of lines) {
    if (inQuotes) {
      current += '\n' + line;
    } else {
      current = line;
    }

    // Count unescaped quotes
    const quoteCount = (current.match(/"/g) || []).length;
    inQuotes = quoteCount % 2 !== 0;

    if (!inQuotes) {
      rows.push(parseCSVRow(current));
      current = '';
    }
  }

  if (current) {
    rows.push(parseCSVRow(current));
  }

  return rows;
}

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  cells.push(current.replace(/\r$/, ''));
  return cells;
}

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { legacyAuth, withAuth } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * DELETE /api/hr/dialer-leads/batches/delete
 * Delete a batch and all its leads
 */
async function POST__handler(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ status: 'error', message: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { payload } = await legacyAuth(request);
    const jwt = payload as unknown as JwtPayload;

    if (jwt.role !== 'hr') {
      return NextResponse.json({ status: 'error', message: 'Access denied. HR only.' }, { status: 403 });
    }

    const body = await request.json();
    const { batch_id } = body;

    if (!batch_id) {
      return NextResponse.json({ status: 'error', message: 'batch_id is required' }, { status: 400 });
    }

    // Delete all leads from this batch first
    const deletedLeads = await query<any>(
      `DELETE FROM dialer_leads WHERE batch_id = $1 RETURNING id`,
      [batch_id]
    );

    // Delete the batch record
    await query(
      `DELETE FROM lead_upload_batches WHERE id = $1`,
      [batch_id]
    );

    return NextResponse.json({
      status: 'success',
      message: `Deleted batch and ${deletedLeads.length} leads`,
      data: { deleted_leads: deletedLeads.length },
    });
  } catch (error) {
    console.error('Delete batch error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to delete batch' },
      { status: 500 }
    );
  }
}

export const POST = withAuth(POST__handler);

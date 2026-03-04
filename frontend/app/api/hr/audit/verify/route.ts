import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { query } from '@/lib/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * Verify JWT and check HR role
 */
async function verifyHRAccess(request: NextRequest): Promise<{ success: true; payload: JwtPayload } | { success: false; error: NextResponse }> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      success: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  try {
    const token = authHeader.split(' ')[1];
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const jwtPayload = payload as unknown as JwtPayload;

    if (jwtPayload.role !== 'hr') {
      return {
        success: false,
        error: NextResponse.json({ error: 'Forbidden - HR access required' }, { status: 403 }),
      };
    }

    return { success: true, payload: jwtPayload };
  } catch {
    return {
      success: false,
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    };
  }
}

/**
 * POST /api/hr/audit/verify
 * 
 * Mark an audit item as verified
 * 
 * Request Body:
 * - auditItemId: UUID of the audit_items row
 * 
 * Logic:
 * 1. Update audit_items setting is_verified = true, verified_at = NOW()
 * 2. Check if ALL audit_items for the parent daily_audit_id are now verified
 * 3. If yes, update daily_audits setting status = 'completed', completed_at = NOW()
 */
export async function POST(request: NextRequest) {
  const authResult = await verifyHRAccess(request);
  if (!authResult.success) {
    return authResult.error;
  }

  try {
    const body = await request.json();
    const { auditItemId } = body;

    if (!auditItemId) {
      return NextResponse.json(
        { error: 'Missing required field: auditItemId' },
        { status: 400 }
      );
    }

    // Get the audit item and its parent audit
    const auditItem = await query<{
      id: string;
      daily_audit_id: string;
      is_verified: boolean;
    }>(`
      SELECT id, daily_audit_id, is_verified
      FROM audit_items
      WHERE id = $1
    `, [auditItemId]);

    if (auditItem.length === 0) {
      return NextResponse.json(
        { error: 'Audit item not found' },
        { status: 404 }
      );
    }

    const dailyAuditId = auditItem[0].daily_audit_id;

    // Mark the item as verified
    await query(`
      UPDATE audit_items
      SET is_verified = true, verified_at = NOW(), verified_by = $1
      WHERE id = $2
    `, [authResult.payload.userId, auditItemId]);

    console.log(`[Verify API] Marked audit_item ${auditItemId} as verified`);

    // Check if all items are now verified
    const verificationStatus = await query<{
      total: string;
      verified: string;
    }>(`
      SELECT 
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE is_verified = true)::text as verified
      FROM audit_items
      WHERE daily_audit_id = $1
    `, [dailyAuditId]);

    const total = parseInt(verificationStatus[0].total, 10);
    const verified = parseInt(verificationStatus[0].verified, 10);
    const allVerified = total > 0 && verified === total;

    console.log(`[Verify API] Audit ${dailyAuditId}: ${verified}/${total} verified`);

    // If all verified, mark the daily audit as completed
    if (allVerified) {
      await query(`
        UPDATE daily_audits
        SET status = 'completed', completed_at = NOW(), audited_by = $1
        WHERE id = $2
      `, [authResult.payload.userId, dailyAuditId]);

      console.log(`[Verify API] Daily audit ${dailyAuditId} marked as COMPLETED`);
    }

    // Get updated audit status
    const updatedAudit = await query<{
      status: string;
      completed_at: string | null;
      auditor_name: string | null;
    }>(`
      SELECT da.status, da.completed_at, u.full_name as auditor_name
      FROM daily_audits da
      LEFT JOIN users u ON u.id = da.audited_by
      WHERE da.id = $1
    `, [dailyAuditId]);

    return NextResponse.json({
      success: true,
      auditItemId,
      isVerified: true,
      verifiedAt: new Date().toISOString(),
      totalItems: total,
      verifiedItems: verified,
      allVerified,
      auditStatus: updatedAudit[0]?.status || 'pending',
      completedAt: updatedAudit[0]?.completed_at || null,
      auditedBy: updatedAudit[0]?.auditor_name || null,
    });

  } catch (error) {
    console.error('Error verifying audit item:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to verify audit item', details: String(error) },
      { status: 500 }
    );
  }
}

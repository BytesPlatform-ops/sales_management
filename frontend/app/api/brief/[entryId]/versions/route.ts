import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { entryCtx } from '@/lib/brief/core';

export const dynamic = 'force-dynamic';

/** GET /api/brief/{entryId}/versions — earlier texts of an entry, newest first. Anyone who can see the project. */
export const GET = handler(async (request: NextRequest, { params }: { params: { entryId: string } }) => {
  const { entry } = await entryCtx(request, Number(params.entryId));
  return ok(await query(
    `SELECT v.id, v.version, v.type, v.body, v.tags, v.created_at, u.full_name AS edited_by_name
       FROM brief_entry_versions v LEFT JOIN users u ON u.id = v.edited_by
      WHERE v.entry_id = $1 ORDER BY v.id DESC`,
    [entry.id]
  ));
});

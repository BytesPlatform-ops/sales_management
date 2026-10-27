import { NextRequest, NextResponse } from 'next/server';
import { handler, readJson } from '@/lib/training/http';
import { audit, decryptSecret, guardValueAccess, loadSecret, projectDataKey, vaultContext } from '@/lib/vault/store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/{id}/env/{secretId}/value { action: 'copy' | 'reveal' }
 * The one route that returns a plain value. Every call is written to vault_audit.
 * POST (not GET) so the value is never in a URL, history, or a shared cache.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string; secretId: string } }) => {
  const ctx = await vaultContext(request, Number(params.id));
  const s = await loadSecret(ctx, Number(params.secretId));
  const b = await readJson(request).catch(() => ({}));
  const action = b.action === 'reveal' ? 'reveal' : 'copy';
  const brokeGlass = await guardValueAccess(ctx, request, s.key_name, s.environment, { id: s.id, key_name: s.key_name }, b);
  const value = decryptSecret(await projectDataKey(ctx.project.id), s);
  if (!brokeGlass) await audit(ctx, action, s.environment, { id: s.id, key_name: s.key_name });
  return NextResponse.json(
    { status: 'success', data: { key: s.key_name, value } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

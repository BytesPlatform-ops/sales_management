import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler } from '@/lib/training/http';
import { VAULT_ENV_LABELS } from '@/lib/vault/access';
import { serializeEnv } from '@/lib/vault/env-file';
import { audit, decryptSecret, guardValueAccess, projectDataKey, requireEnv, SecretRow, vaultContext } from '@/lib/vault/store';

export const dynamic = 'force-dynamic';

/** GET /api/projects/{id}/env/export?environment=development — the whole environment as a .env file. Logged. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await vaultContext(request, Number(params.id));
  const env = requireEnv(ctx, new URL(request.url).searchParams.get('environment'));
  const brokeGlass = await guardValueAccess(ctx, request, 'the whole .env file', env, null);
  const rows = await query<SecretRow>(
    `SELECT id, project_id, environment, key_name, ciphertext, iv, tag, note FROM vault_secrets
      WHERE project_id = $1 AND environment = $2 ORDER BY key_name`,
    [ctx.project.id, env]
  );
  const dataKey = rows.length ? await projectDataKey(ctx.project.id) : null;
  const text = serializeEnv(
    rows.map((s) => ({ key: s.key_name, value: decryptSecret(dataKey!, s) })),
    `${ctx.project.ticket_no} · ${VAULT_ENV_LABELS[env]}\nDownloaded by ${ctx.viewer.name} on ${new Date().toISOString().slice(0, 10)}. Do not commit or share this file.`
  );
  if (!brokeGlass) await audit(ctx, 'download', env, null);
  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ctx.project.ticket_no}.${env}.env"`,
      'Cache-Control': 'no-store',
    },
  });
});

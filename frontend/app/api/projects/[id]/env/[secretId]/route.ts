import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { VAULT_ENV_LABELS } from '@/lib/vault/access';
import { isValidKey } from '@/lib/vault/env-file';
import { audit, checkValue, decryptSecret, encryptValue, loadSecret, projectDataKey, requireVaultWrite, vaultContext } from '@/lib/vault/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string; secretId: string } };

/** PATCH /api/projects/{id}/env/{secretId} { key?, value?, note? } — rename, change value, or edit the note. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await vaultContext(request, Number(params.id));
  requireVaultWrite(ctx);
  const s = await loadSecret(ctx, Number(params.secretId));
  const b = await readJson(request);

  const newKey = b.key === undefined ? s.key_name : String(b.key).trim();
  if (!isValidKey(newKey)) throw new HttpError(400, 'Key must start with a letter or _ and use only letters, numbers, _ . -');
  const note = b.note === undefined ? s.note : (typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null);
  const valueChanged = b.value !== undefined;

  // The ciphertext is bound to the key name, so a rename re-encrypts too.
  let sealed = null;
  if (valueChanged || newKey !== s.key_name) {
    const dataKey = await projectDataKey(ctx.project.id);
    const value = valueChanged ? checkValue(b.value) : decryptSecret(dataKey, s);
    sealed = encryptValue(dataKey, ctx.project.id, s.environment, newKey, value);
  }

  try {
    await queryOne(
      `UPDATE vault_secrets SET key_name = $2, note = $3,
              ciphertext = COALESCE($4, ciphertext), iv = COALESCE($5, iv), tag = COALESCE($6, tag),
              updated_by = $7, updated_at = NOW()
        WHERE id = $1`,
      [s.id, newKey, note, sealed?.ciphertext ?? null, sealed?.iv ?? null, sealed?.tag ?? null, ctx.viewer.userId]
    );
  } catch (err: any) {
    if (err?.code === '23505') throw new HttpError(409, `${newKey} already exists in this environment`);
    throw err;
  }
  await audit(ctx, 'update', s.environment, { id: s.id, key_name: newKey });
  if (valueChanged || newKey !== s.key_name) {
    const what = newKey !== s.key_name ? `renamed ${s.key_name} to ${newKey}` : `updated ${newKey}`;
    await systemMessage(ctx.project.id, `${ctx.viewer.name} ${what} in ${VAULT_ENV_LABELS[s.environment]} env.`, ctx.viewer.userId);
  }
  return ok({ id: s.id });
});

/** DELETE /api/projects/{id}/env/{secretId} */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const ctx = await vaultContext(request, Number(params.id));
  requireVaultWrite(ctx);
  const s = await loadSecret(ctx, Number(params.secretId));
  await query(`DELETE FROM vault_secrets WHERE id = $1`, [s.id]);
  await audit(ctx, 'delete', s.environment, { id: s.id, key_name: s.key_name });
  await systemMessage(ctx.project.id, `${ctx.viewer.name} removed ${s.key_name} from ${VAULT_ENV_LABELS[s.environment]} env.`, ctx.viewer.userId);
  return ok({ deleted: s.id });
});

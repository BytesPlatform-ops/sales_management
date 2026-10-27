import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { systemMessage } from '@/lib/projects/core';
import { envAccessMap, isVaultEnv, VAULT_ENV_LABELS, VaultEnv } from '@/lib/vault/access';
import { isValidKey, parseEnv } from '@/lib/vault/env-file';
import {
  audit, checkValue, decryptSecret, envAccess, MAX_IMPORT_ENTRIES, projectDataKey, requireEnv, requireVaultWrite, SecretRow, upsertSecret, vaultContext,
} from '@/lib/vault/store';

import { ceoTwoFactorRequired } from '@/lib/auth/twofactor';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/{id}/env?environment=development
 * Variable names and notes for one environment — never values.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await vaultContext(request, Number(params.id));
  const asked = new URL(request.url).searchParams.get('environment') || 'development';
  // Someone with only individual shared secrets sees just those.
  const level = isVaultEnv(asked) ? envAccess(ctx, asked) : null;
  const env = level === 'items' ? (asked as VaultEnv) : requireEnv(ctx, asked);
  const onlyIds = level === 'items' ? Array.from(ctx.sharedSecrets.keys()) : null;
  const rows = await query(
    `SELECT s.id, s.key_name, s.note, s.created_at, s.updated_at,
            cu.full_name AS created_by_name, uu.full_name AS updated_by_name
       FROM vault_secrets s
       LEFT JOIN users cu ON cu.id = s.created_by
       LEFT JOIN users uu ON uu.id = s.updated_by
      WHERE s.project_id = $1 AND s.environment = $2 AND ($3::int[] IS NULL OR s.id = ANY($3::int[]))
      ORDER BY s.key_name`,
    [ctx.project.id, env, onlyIds]
  );
  const access = envAccessMap(ctx.viewer.role, ctx.memberRole);
  for (const e of ctx.grantEnvs) access[e] = true;
  return ok({
    environment: env, access, secrets: rows, read_only: ctx.readOnly,
    // CEOs see names and audit; values need break-glass (code + reason). View-as never sees values.
    break_glass: ctx.viewer.realRole === 'ceo', break_glass_code: ctx.viewer.realRole === 'ceo' && ceoTwoFactorRequired(), values_hidden: !!ctx.viewer.readonly,
  });
});

/**
 * POST /api/projects/{id}/env
 *   { environment, key, value, note? }        add or overwrite one variable
 *   { environment, dotenv, dry_run? }          import a pasted .env file;
 *                                              dry_run returns new/changed/same per key without saving
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await vaultContext(request, Number(params.id));
  requireVaultWrite(ctx);
  const b = await readJson(request);
  const env = requireEnv(ctx, b.environment);
  const label = VAULT_ENV_LABELS[env];

  if (typeof b.dotenv === 'string') {
    const { entries, errors } = parseEnv(b.dotenv);
    if (!entries.length) throw new HttpError(400, errors.length ? `Nothing to import (line ${errors[0].line}: ${errors[0].message})` : 'Nothing to import');
    if (entries.length > MAX_IMPORT_ENTRIES) throw new HttpError(400, `At most ${MAX_IMPORT_ENTRIES} variables per import`);
    entries.forEach((e) => checkValue(e.value));

    const dataKey = await projectDataKey(ctx.project.id);
    const existing = await query<SecretRow>(
      `SELECT id, project_id, environment, key_name, ciphertext, iv, tag, note FROM vault_secrets WHERE project_id = $1 AND environment = $2`,
      [ctx.project.id, env]
    );
    const current = new Map(existing.map((s) => [s.key_name, s]));
    const plan = entries.map((e) => {
      const s = current.get(e.key);
      const status = !s ? 'new' : decryptSecret(dataKey, s) === e.value ? 'same' : 'changed';
      return { key: e.key, status, value: e.value };
    });

    if (b.dry_run) return ok({ dry_run: true, plan: plan.map(({ key, status }) => ({ key, status })), errors });

    let created = 0, updated = 0;
    for (const p of plan) {
      if (p.status === 'same') continue;
      const r = await upsertSecret(ctx, dataKey, env, p.key, p.value, null);
      await audit(ctx, r.created ? 'create' : 'update', env, { id: r.id, key_name: p.key });
      r.created ? created++ : updated++;
    }
    await audit(ctx, 'import', env, null);
    if (created || updated) {
      await systemMessage(ctx.project.id,
        `${ctx.viewer.name} imported a .env into ${label} env (${created} added, ${updated} updated).`, ctx.viewer.userId);
    }
    return ok({ created, updated, unchanged: plan.length - created - updated, errors });
  }

  const key = String(b.key ?? '').trim();
  if (!isValidKey(key)) throw new HttpError(400, 'Key must start with a letter or _ and use only letters, numbers, _ . -');
  const value = checkValue(b.value);
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  const dataKey = await projectDataKey(ctx.project.id);
  const r = await upsertSecret(ctx, dataKey, env, key, value, note);
  await audit(ctx, r.created ? 'create' : 'update', env, { id: r.id, key_name: key });
  await systemMessage(ctx.project.id, `${ctx.viewer.name} ${r.created ? 'added' : 'updated'} ${key} in ${label} env.`, ctx.viewer.userId);
  return ok({ id: r.id, created: r.created });
});

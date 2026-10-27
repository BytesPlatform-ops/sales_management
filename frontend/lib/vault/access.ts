/**
 * Who may use a project's Env.
 *
 *   hr                         everything, every environment
 *   developer on the project   Development + Staging (view, copy, add, edit)
 *   lead developer             also Production
 *   agents, watchers, others   nothing
 *
 * Checked on every request against project_members, so removing someone from
 * the project (or deactivating them) cuts access immediately.
 */
export const VAULT_ENVS = ['development', 'staging', 'production'] as const;
export type VaultEnv = (typeof VAULT_ENVS)[number];

export const VAULT_ENV_LABELS: Record<VaultEnv, string> = {
  development: 'Development', staging: 'Staging', production: 'Production',
};

export function isVaultEnv(v: unknown): v is VaultEnv {
  return typeof v === 'string' && (VAULT_ENVS as readonly string[]).includes(v);
}

export function canUseEnv(role: string, memberRole: string | null | undefined, env: VaultEnv): boolean {
  if (role === 'hr') return true;
  if (role !== 'developer') return false;
  if (memberRole === 'lead_developer') return true;
  if (memberRole === 'developer') return env !== 'production';
  return false;
}

export function envAccessMap(role: string, memberRole: string | null | undefined): Record<VaultEnv, boolean> {
  return Object.fromEntries(VAULT_ENVS.map((e) => [e, canUseEnv(role, memberRole, e)])) as Record<VaultEnv, boolean>;
}

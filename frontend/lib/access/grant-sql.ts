/** SQL fragments for access grants (no database import: safe to use anywhere). */
/** SQL condition: grant row `g` is in force right now. */
export const ACTIVE_GRANT = (g = 'g') =>
  `(${g}.revoked_at IS NULL AND ${g}.starts_at <= NOW() AND (${g}.expires_at IS NULL OR ${g}.expires_at > NOW())
    AND NOT COALESCE((${g}.scope->>'pending_approval')::boolean, false))`;

/** SQL: the user ($param) has a project-level grant on project `alias`.id. */
export const projectGrantSql = (alias: string, userParam = '$1') =>
  `EXISTS (SELECT 1 FROM access_grants g WHERE g.grantee_id = ${userParam} AND g.resource_type = 'project'
            AND g.resource_id = ${alias}.id::text AND ${ACTIVE_GRANT('g')})`;

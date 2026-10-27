/**
 * A small GitHub App client: App JWT (RS256) → installation token (cached until it
 * expires) → the handful of REST calls we need. OAuth for linking a developer's
 * account uses the same App's client id/secret.
 *
 * Env: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (PEM; "\n" escapes are fine),
 *      GITHUB_ORG, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET.
 *
 * Tests swap in a fake with setGitHubClient().
 */
import { createPrivateKey } from 'crypto';
import { SignJWT } from 'jose';
import { HttpError } from '@/lib/training/http';

export interface RepoInfo { id: number; full_name: string; html_url: string; default_branch: string }
export interface GitHubUser { id: number; login: string }

export interface GitHubClient {
  configured(): boolean;
  createOrgRepo(name: string, description: string): Promise<RepoInfo>;
  getRepo(fullName: string): Promise<RepoInfo>;
  addCollaborator(fullName: string, login: string, permission: 'push' | 'pull'): Promise<void>;
  removeCollaborator(fullName: string, login: string): Promise<void>;
  oauthAuthorizeUrl(state: string, redirectUri: string): string;
  oauthExchange(code: string, redirectUri: string): Promise<string>;
  getAuthenticatedUser(userToken: string): Promise<GitHubUser>;
}

const API = 'https://api.github.com';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpError(503, `GitHub is not configured on the server (${name})`);
  return v;
}

function privateKey() {
  return createPrivateKey(env('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'));
}

let installation: { token: string; expiresAt: number } | null = null;

async function appJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({}).setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60).setExpirationTime(now + 9 * 60).setIssuer(env('GITHUB_APP_ID'))
    .sign(privateKey());
}

async function gh<T>(path: string, init: RequestInit & { token?: string; app?: boolean } = {}): Promise<T> {
  const token = init.app ? await appJwt() : init.token ?? (await installationToken());
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} failed (${res.status}): ${body?.message || 'unknown error'}`);
  return body as T;
}

async function installationToken(): Promise<string> {
  if (installation && installation.expiresAt - Date.now() > 60_000) return installation.token;
  const inst = await gh<{ id: number }>(`/orgs/${encodeURIComponent(env('GITHUB_ORG'))}/installation`, { app: true });
  const t = await gh<{ token: string; expires_at: string }>(`/app/installations/${inst.id}/access_tokens`, { method: 'POST', app: true });
  installation = { token: t.token, expiresAt: new Date(t.expires_at).getTime() };
  return t.token;
}

const repo = (r: any): RepoInfo => ({ id: r.id, full_name: r.full_name, html_url: r.html_url, default_branch: r.default_branch || 'main' });

export const realGitHubClient: GitHubClient = {
  configured: () => !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_ORG),
  async createOrgRepo(name, description) {
    return repo(await gh(`/orgs/${encodeURIComponent(env('GITHUB_ORG'))}/repos`, {
      method: 'POST', body: JSON.stringify({ name, description, private: true, auto_init: true }),
    }));
  },
  async getRepo(fullName) {
    return repo(await gh(`/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`));
  },
  async addCollaborator(fullName, login, permission) {
    await gh(`/repos/${fullName.split('/').map(encodeURIComponent).join('/')}/collaborators/${encodeURIComponent(login)}`, {
      method: 'PUT', body: JSON.stringify({ permission }),
    });
  },
  async removeCollaborator(fullName, login) {
    await gh(`/repos/${fullName.split('/').map(encodeURIComponent).join('/')}/collaborators/${encodeURIComponent(login)}`, { method: 'DELETE' });
  },
  oauthAuthorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({ client_id: env('GITHUB_CLIENT_ID'), state, redirect_uri: redirectUri, allow_signup: 'false' });
    return `https://github.com/login/oauth/authorize?${q}`;
  },
  async oauthExchange(code, redirectUri) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env('GITHUB_CLIENT_ID'), client_secret: env('GITHUB_CLIENT_SECRET'), code, redirect_uri: redirectUri }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.access_token) throw new HttpError(400, 'GitHub did not accept the sign-in code — try again');
    return j.access_token as string;
  },
  async getAuthenticatedUser(userToken) {
    const u = await gh<{ id: number; login: string }>('/user', { token: userToken });
    return { id: u.id, login: u.login };
  },
};

let current: GitHubClient = realGitHubClient;
export const github = () => current;
/** Tests only. */
export function setGitHubClient(c: GitHubClient | null) { current = c || realGitHubClient; installation = null; }

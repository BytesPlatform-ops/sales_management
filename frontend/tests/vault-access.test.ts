import { describe, expect, it } from 'vitest';
import { canUseEnv, envAccessMap } from '@/lib/vault/access';

describe('Env access rules', () => {
  it('HR has every environment', () => {
    expect(envAccessMap('hr', null)).toEqual({ development: true, staging: true, production: true });
  });
  it('a project developer has Development and Staging only', () => {
    expect(envAccessMap('developer', 'developer')).toEqual({ development: true, staging: true, production: false });
  });
  it('a lead developer also has Production', () => {
    expect(envAccessMap('developer', 'lead_developer')).toEqual({ development: true, staging: true, production: true });
  });
  it('agents, watchers and developers not on the project have nothing', () => {
    for (const [role, member] of [['agent', null], ['agent', 'watcher'], ['agent', 'lead_developer'], ['developer', 'watcher'], ['developer', null]] as const) {
      expect(Object.values(envAccessMap(role, member)).some(Boolean)).toBe(false);
    }
    expect(canUseEnv('agent', 'developer', 'development')).toBe(false);
  });
});

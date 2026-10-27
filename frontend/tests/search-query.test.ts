import { describe, expect, it } from 'vitest';
import { parseSearch } from '@/lib/search/query';

const T = '2026-10-28';

describe('search syntax', () => {
  it('plain words stay text and search everything', () => {
    const q = parseSearch('booking button', T);
    expect(q.text).toBe('booking button');
    expect(q.ticketOnly).toBe(false);
  });
  it('reads filters, including quoted values and status labels', () => {
    const q = parseSearch('assignee:me status:"In progress" type:bug priority:urgent project:prj-0012 login', T);
    expect(q).toMatchObject({ assignee: 'me', status: ['in_progress'], type: 'bug', priority: 'urgent', project: 'PRJ-0012', text: 'login', ticketOnly: true });
  });
  it('accepts status codes, lists and type aliases', () => {
    expect(parseSearch('status:in_review,in_qa', T).status).toEqual(['in_review', 'in_qa']);
    expect(parseSearch('type:cr', T).type).toBe('change_request');
    expect(parseSearch('type:"Change request"', T).type).toBe('change_request');
  });
  it('resolves due dates relative to today', () => {
    expect(parseSearch('due:<today', T).due).toEqual({ op: '<', date: T });
    expect(parseSearch('due:>2026-11-01', T).due).toEqual({ op: '>', date: '2026-11-01' });
    expect(parseSearch('due:tomorrow', T).due).toEqual({ op: '=', date: '2026-10-29' });
    expect(parseSearch('due:overdue', T)).toMatchObject({ due: { op: '<', date: T }, open: true });
  });
  it('is:blocked / is:open / is:mine', () => {
    expect(parseSearch('is:blocked', T)).toMatchObject({ blocked: true, ticketOnly: true, text: '' });
    expect(parseSearch('is:mine', T).mine).toBe(true);
  });
  it('unknown keys and bad values stay as plain words', () => {
    const q = parseSearch('foo:bar status:nonsense due:soon', T);
    expect(q.text).toBe('foo:bar status:nonsense due:soon');
    expect(q.ticketOnly).toBe(false);
  });
  it('a ticket key on its own is a jump', () => {
    expect(parseSearch('prj-0012-t5', T).key).toBe('PRJ-0012-T5');
    expect(parseSearch('PRJ-0012-T5 login', T).key).toBeUndefined();
  });
  it('project: alone does not restrict to tickets', () => {
    expect(parseSearch('project:PRJ-0001', T).ticketOnly).toBe(false);
  });
});

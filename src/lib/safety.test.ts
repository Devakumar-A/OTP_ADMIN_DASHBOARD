import { describe, it, expect, vi } from 'vitest';
import { fetchAll } from './data';

describe('read-only guard', () => {
  it('refuses every write verb to the data API before any network call', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: any, init?: any) => {
      calls.push(`${init?.method ?? 'GET'} ${String(u)}`);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { supabase } = await import('./supabase');
    const t = supabase.from('guest_stays') as any;
    const results = await Promise.all([
      t.insert({ guest_name: 'x' }),
      t.update({ guest_name: 'x' }).eq('id', '1'),
      t.upsert({ id: '1' }),
      t.delete().eq('id', '1'),
    ]);
    for (const r of results) expect(String(r.error?.message ?? r.error)).toMatch(/read-only|Blocked/i);
    expect(calls.filter((c) => !c.startsWith('GET') && !c.startsWith('HEAD'))).toEqual([]);
  });
});

describe('fetchAll paging', () => {
  it('reads every page and reports the total', async () => {
    const total = 2500;
    const make = () => ({
      range: async (from: number, to: number) => ({
        data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ id: from + i })),
        count: total,
        error: null,
      }),
    });
    const r = await fetchAll<any>(make as any);
    expect(r.rows.length).toBe(total);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(total);
    expect(r.truncated).toBe(false);
  });
});

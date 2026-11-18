import { useMemo } from 'react';
import { Filters } from '../lib/filters';
import { useStayFacts, useExtFacts } from './data';
import { computeTotals, dataQuality } from '../lib/finance';
import { env } from '../config';

/** Stay + extension facts for one filter set, with reconciled totals. */
export function useFinance(f: Filters, opts: { skipDate?: boolean } = {}) {
  const stays = useStayFacts(f, !!opts.skipDate);
  const exts = useExtFacts(f, !!opts.skipDate);
  const data = useMemo(() => {
    if (!stays.data || !exts.data) return null;
    return {
      stays: stays.data.rows,
      exts: exts.data.rows,
      totals: computeTotals(stays.data.rows, exts.data.rows, env.extIncluded),
      quality: dataQuality(stays.data.rows),
      truncated: stays.data.truncated || exts.data.truncated,
    };
  }, [stays.data, exts.data]);
  return {
    data,
    loading: stays.isLoading || exts.isLoading,
    error: stays.error || exts.error,
    refetch: async () => {
      await Promise.all([stays.refetch(), exts.refetch()]);
    },
  };
}

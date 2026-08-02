import { supabase } from '@/lib/supabase';
import { getActiveHours, type Shift } from '@/types';

export interface JobSnapshot {
  id: string;
  capture_time: string;
  job_id: number | null;
  product_name: string | null;
  sku: string | null;
  order_name: string | null;
  quantity: number | null;
  produced: number | null;
  run_state: string | null;
}

/**
 * Fetches job snapshots from the database for a given date and shift window.
 * Groups them by job_id and returns one line per distinct job:
 *   "Job 1 — P-284 (V Blue 24x250ml)"
 *   "Job 2 — P-285 (C Orange 12x330ml)"
 *
 * If no jobs were active during that shift window, returns an empty array.
 */
export async function fetchJobsForShift(
  date: string,
  shift: Shift,
  customHours: string[],
): Promise<string[]> {
  if (!date) return [];

  const hours = getActiveHours(shift, customHours);
  if (hours.length === 0) return [];

  const shiftStartStr = hours[0]!.split(' - ')[0]!.trim();
  const isOvernight = parseInt(shiftStartStr.split(':')[0] ?? '0', 10) >= 12;

  const startTs = new Date(`${date}T00:00:00`).toISOString();
  let endTs: string;
  if (isOvernight) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 2);
    endTs = d.toISOString();
  } else {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + 1);
    endTs = d.toISOString();
  }

  const { data, error } = await supabase
    .from('job_snapshots')
    .select('capture_time, job_id, product_name, sku, order_name, quantity, produced, run_state')
    .gte('capture_time', startTs)
    .lt('capture_time', endTs)
    .order('capture_time', { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const jobLines: string[] = [];
  const seenJobIds = new Set<number>();

  for (const row of data as JobSnapshot[]) {
    const jid = row.job_id;
    if (jid === null) continue;
    if (seenJobIds.has(jid)) continue;
    seenJobIds.add(jid);

    const product = row.product_name ?? row.order_name ?? `Job ${jid}`;
    const sku = row.sku;
    const label = sku ? `${product} (${sku})` : product;
    jobLines.push(`Job ${jobLines.length + 1}\n${label}`);
  }

  return jobLines;
}

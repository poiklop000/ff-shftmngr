export interface OfsCounts {
  through?: number;
  rated?: number;
  out?: number;
  "out.unadjusted"?: number;
  "rated.unadjusted"?: number;
  "out.raw"?: number;
  "through.unadjusted"?: number;
}

export interface OfsCrew {
  name?: string;
  title?: string;
}

export interface OfsUser {
  name?: string;
  title?: string;
}

export interface OfsShift {
  id?: number;
  start?: number;
  startText?: string;
  duration?: number;
  type?: string;
  counts?: OfsCounts;
  $crew?: OfsCrew;
  $user?: OfsUser;
}

export interface OfsOrderProduct {
  name?: string;
  description?: string;
  SKU?: string;
}

export interface OfsOrder {
  clientId?: string;
  name?: string;
  $product?: OfsOrderProduct;
}

export interface OfsJob {
  id?: number;
  start?: number;
  startText?: string;
  duration?: number;
  quantity?: number;
  type?: string;
  counts?: OfsCounts;
  metadata?: {
    cansPerCarton?: string;
    ratedSpeed?: string;
    unitsToMake?: string;
    outCounterLocation?: string;
    [k: string]: string | undefined;
  };
  $order?: OfsOrder;
}

export interface OfsRunState {
  name?: string;
  description?: string;
  color?: string;
  state?: string;
  start?: number;
  duration?: number;
}

export interface OfsProcessCounter {
  rate?: number;
  value?: number;
}

export interface OfsProcess {
  throughunitpersister?: OfsProcessCounter;
  unitsout?: OfsProcessCounter;
  outunitpersister?: OfsProcessCounter;
  unitsin?: OfsProcessCounter;
  ratedunitpersister?: OfsProcessCounter;
}

export interface OfsWorkcentre {
  name?: string;
  title?: string;
  console?: string;
  consoletimezone?: string;
  consoletimeText?: string;
}

export interface OfsLiveStatus {
  timestamp?: number;
  timestampText?: string;
  workcentre?: OfsWorkcentre;
  shift?: OfsShift;
  job?: OfsJob;
  runstate?: OfsRunState;
  process?: OfsProcess;
  states?: Record<string, number>;
}

export interface OfsStatusResponse {
  console: string;
  endpoint: string;
  fetchedAt: string;
  data: OfsLiveStatus;
}

export interface OfsReasonCategory {
  category?: string;
  description?: string;
}

export interface OfsReason {
  description?: string;
  category?: OfsReasonCategory;
  downtimeType?: string;
}

export interface OfsSpanItem {
  id?: number;
  type?: string;
  state?: string;
  start?: number;
  startText?: string;
  duration?: number;
  counts?: OfsCounts;
  $reason?: OfsReason;
  $crew?: OfsCrew;
  $user?: OfsUser;
  class?: string;
}

export interface OfsSpansData {
  downtime?: OfsSpanItem;
  items?: OfsSpanItem[];
  series?: unknown;
  timestampText?: string;
}

export interface OfsSpansResponse {
  console: string;
  endpoint: string;
  fetchedAt: string;
  data: OfsSpansData;
}

const OFS_DISCONNECTED = "OFS data feed is disconnected";

async function fetchOfsEndpoint<T>(
  _endpoint: string,
  _signal?: AbortSignal,
): Promise<T> {
  throw new Error(OFS_DISCONNECTED);
}

export type LineStateClass = 'running' | 'setup' | 'downtime' | 'planned' | 'idle';

export const LINE_STATE_COLORS: Record<LineStateClass, string> = {
  running: '#16a34a',
  setup: '#eab308',
  downtime: '#dc2626',
  planned: '#2563eb',
  idle: '#94a3b8',
};

export function classifyLineState(runstate: OfsRunState | undefined): LineStateClass {
  const state = runstate?.state?.toLowerCase() ?? '';
  // Order matters: a single state string can contain multiple keywords.
  // "job.setup.running" contains both "setup" and "running", so setup must
  // be checked before running. "unplanned" contains the substring "planned",
  // so it must be checked before "planned" to avoid misclassifying unplanned
  // downtime as planned (blue instead of red).
  if (state.includes('setup')) return 'setup';
  if (state.includes('unplanned')) return 'downtime';
  if (state.includes('planned')) return 'planned';
  if (state.includes('downtime')) return 'downtime';
  if (state.includes('running')) return 'running';
  if (state.includes('shift') || state.includes('job')) return 'idle';
  return 'idle';
}

export async function fetchOfsStatus(signal?: AbortSignal): Promise<OfsLiveStatus> {
  return fetchOfsEndpoint<OfsLiveStatus>("live/status", signal);
}

export async function fetchOfsSpans(signal?: AbortSignal): Promise<OfsSpansData> {
  return fetchOfsEndpoint<OfsSpansData>("live/spans", signal);
}

export interface ExpressSpanComment {
  commentId: number;
  author: string;
  userName: string;
  text: string;
  commentTimestamp: number;
  systemPost: boolean;
  crewName?: string;
}

export interface ExpressSpan {
  id: number;
  type: string;
  spanType?: string;
  spanClass?: string;
  start: number;
  end?: number;
  reasonId?: number;
  reasonName?: string;
  reasonDescription?: string;
  reasonType?: string;
  reasonCategory?: number;
  reasonCategoryName?: string;
  crewId?: number;
  shiftId?: number;
  shiftStart?: number;
  shiftEnd?: number;
  jobId?: number;
  jobStart?: number;
  jobEnd?: number;
  jobQuantity?: number;
  orderId?: number;
  orderQuantity?: number;
  userId?: number;
  comments?: ExpressSpanComment[];
}

interface ExpressSpansResponse {
  spans: ExpressSpan[];
}

export async function fetchExpressSpans(signal?: AbortSignal): Promise<ExpressSpan[]> {
  const data = await fetchOfsEndpoint<ExpressSpansResponse>("data/express/spans", signal);
  return data.spans ?? [];
}

export interface OfsHourSummaryCounts {
  units?: number;
}

export interface OfsHourSummarySpanSummary {
  duration?: number;
  counts?: Record<string, OfsHourSummaryCounts>;
}

export interface OfsHourSummaryItem {
  id: number;
  start: number;
  end: number;
  startText: string;
  endText: string;
  spanSummaries?: Record<string, OfsHourSummarySpanSummary>;
}

export interface OfsHourSummaryData {
  start: number;
  end: number;
  startText: string;
  endText: string;
  items: OfsHourSummaryItem[];
}

export async function fetchHourlySummary(
  _startDate?: string,
  _endDate?: string,
  _signal?: AbortSignal,
): Promise<OfsHourSummaryData> {
  throw new Error(OFS_DISCONNECTED);
}

// sync-spans-history — backfill and sync full downtime event history from OFS
//
// Fetches the complete span history from `/server/data/express/spans` which
// contains every downtime event (resolved and ongoing) with rich metadata:
// crew, job, shift, user, comments, reason category, etc.
//
// On each run it upserts all spans into downtime_events. Existing rows are
// updated with the latest data (e.g. resolved end times, newly added
// comments). New rows are inserted. The `source` column is set to 'history'
// for spans that come from this sync (as opposed to 'live' real-time
// captures).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OFS_BASE = "https://free-flow.ofsxpress.com";
const CONSOLE = "OFS002";
const SERVER_PATH = `/OFS002/server`;
const CONSOLE_NAME = "Krones Canning Line";

interface ExpressSpan {
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
  crewSortIndex?: number;
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
  comments?: Array<{
    commentId: number;
    author: string;
    userName: string;
    text: string;
    commentTimestamp: number;
    systemPost: boolean;
  }>;
}

interface ExpressSpansResponse {
  spans: ExpressSpan[];
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchSpansHistory(): Promise<ExpressSpan[]> {
  const user = Deno.env.get("OFS_USER");
  const pass = Deno.env.get("OFS_PASS");
  if (!user || !pass) throw new Error("OFS credentials not configured");
  const auth = `Basic ${btoa(`${user}:${pass}`)}`;
  const res = await fetch(`${OFS_BASE}${SERVER_PATH}/data/express/spans`, {
    method: "GET",
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OFS data/express/spans returned ${res.status}`);
  const data = (await res.json()) as ExpressSpansResponse;
  return data.spans ?? [];
}

function spanToRecord(span: ExpressSpan) {
  const end = span.end ?? 0;
  const resolved = end > 0;
  const duration = resolved ? end - span.start : Date.now() - span.start;

  // Map OFS spanType to our state/downtime_type
  const downtimeType = span.reasonType ?? null;
  const state = span.spanType ?? null;

  // start_text in console local time (Pacific/Auckland = UTC+12)
  const startText = formatEpochConsole(span.start);

  // OFS express/spans often returns crewId=0 at span level, but the crew
  // info is available inside the comments. Extract it from the first comment.
  let crewId = span.crewId ?? null;
  let crewName: string | null = null;
  if (crewId && crewId > 0) {
    crewName = crewNameFromId(crewId);
  }
  if ((!crewId || crewId === 0) && span.comments && span.comments.length > 0) {
    const firstComment = span.comments[0];
    if (firstComment.crewId && firstComment.crewId > 0) {
      crewId = firstComment.crewId;
      crewName = firstComment.crewName ?? crewNameFromId(firstComment.crewId);
    }
  }

  // Extract user name from comments if available
  let userName: string | null = null;
  if (span.comments && span.comments.length > 0) {
    userName = span.comments[0].userName ?? null;
  }

  return {
    id: span.id,
    console_id: CONSOLE,
    console_name: CONSOLE_NAME,
    span_id: span.id,
    state,
    downtime_type: downtimeType,
    reason: span.reasonDescription ?? null,
    category: span.reasonCategoryName ?? null,
    start_epoch: span.start,
    start_text: startText,
    end_epoch: resolved ? end : null,
    duration_ms: duration,
    resolved,
    span_class: span.spanClass ?? null,
    span_type: span.spanType ?? null,
    reason_id: span.reasonId ?? null,
    reason_category: span.reasonCategory ?? null,
    reason_category_name: span.reasonCategoryName ?? null,
    reason_type: span.reasonType ?? null,
    crew_id: crewId,
    crew_name: crewName,
    shift_id: span.shiftId ?? null,
    shift_start: span.shiftStart ?? null,
    shift_end: span.shiftEnd ?? null,
    job_id: span.jobId ?? null,
    job_start: span.jobStart ?? null,
    job_end: span.jobEnd ?? null,
    job_quantity: span.jobQuantity ?? null,
    order_id: span.orderId ?? null,
    order_quantity: span.orderQuantity ?? null,
    user_id: span.userId ?? null,
    user_name: userName,
    comments: span.comments ?? null,
    source: "history",
    updated_at: new Date().toISOString(),
  };
}

const CREW_NAMES: Record<number, string> = {
  1: "Graveyard",
  2: "Evening",
  3: "Morning",
};
function crewNameFromId(id?: number): string | null {
  if (id == null || id === 0) return null;
  return CREW_NAMES[id] ?? null;
}

function formatEpochConsole(epochMs: number): string {
  // OFS console is Pacific/Auckland (UTC+12 or UTC+13 during NZDT)
  // Format as "YYYY-MM-DD HH:MM:SS.mmm" to match start_text from live feed
  const date = new Date(epochMs);
  // Use Intl to get Auckland time parts
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const ms = String(epochMs % 1000).padStart(3, "0");
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}.${ms}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Only GET and POST are supported" }, 405);
  }
  try {
    const supabase = getSupabase();
    const spans = await fetchSpansHistory();
    console.log(`[sync-spans-history] Fetched ${spans.length} spans from OFS`);

    let inserted = 0;
    let updated = 0;
    const BATCH_SIZE = 50;
    const records = spans.map(spanToRecord);

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from("downtime_events")
        .upsert(batch, {
          onConflict: "id",
          ignoreDuplicates: false,
        })
        .select("id");
      if (error) {
        console.error(`[sync-spans-history] Batch ${i} error:`, error.message);
        throw new Error(error.message);
      }
      updated += data?.length ?? 0;
    }

    inserted = updated;

    console.log(
      `[sync-spans-history] ${new Date().toISOString()} synced ${spans.length} spans (${inserted} upserted)`,
    );
    return json({
      ok: true,
      totalSpans: spans.length,
      upserted: inserted,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[sync-spans-history] ${new Date().toISOString()} error:`, message);
    return json({ ok: false, error: message }, 502);
  }
});

// slack-downtime-alert — sends a Slack notification when a downtime event
// crosses the 10-minute threshold.
//
// Designed to run on a schedule (every minute via pg_cron). On each run it:
//   1. Finds unresolved downtime events whose duration >= 10 minutes
//   2. Filters out events already alerted (slack_alerted = true)
//   3. Posts a message to Slack via an incoming webhook URL
//   4. Marks each alerted event so it won't be sent again
//
// The webhook URL and threshold are stored in the app_config table so they can
// be changed from the app's settings UI without redeploying.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALERT_THRESHOLD_MIN = 10;

interface DowntimeRow {
  id: number;
  console_name: string | null;
  downtime_type: string | null;
  reason: string | null;
  category: string | null;
  start_epoch: number;
  duration_ms: number | null;
  start_text: string | null;
  crew_name: string | null;
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildSlackMessage(evt: DowntimeRow): Record<string, unknown> {
  const durationMs = evt.duration_ms ?? (Date.now() - evt.start_epoch);
  const lineName = evt.console_name ?? "Production Line";
  const typeLabel = evt.downtime_type ?? "Downtime";
  const reason = evt.reason ?? "No reason recorded";
  const category = evt.category ?? "Uncategorised";
  const crew = evt.crew_name ? ` | Crew: ${evt.crew_name}` : "";
  const startTime = evt.start_text ?? new Date(evt.start_epoch).toISOString();

  return {
    text: `Downtime Alert — ${lineName}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `Downtime Alert — ${lineName}` },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${typeLabel}* downtime has exceeded *${ALERT_THRESHOLD_MIN} minutes*.\n\n*Reason:* ${reason}\n*Category:* ${category}\n*Duration:* ${formatDuration(durationMs)}\n*Started:* ${startTime}${crew}`,
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "Sent automatically by Free-Flow Shift Manager Console" },
        ],
      },
    ],
  };
}

async function sendSlack(webhookUrl: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
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

    // Read webhook URL from app_config
    const { data: cfgRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "slack_webhook_url")
      .maybeSingle();
    const webhookUrl = cfgRow?.value?.trim();

    // Read optional enabled flag (default to disabled if not set)
    const { data: enabledRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "slack_alerts_enabled")
      .maybeSingle();
    const enabled = enabledRow?.value?.toLowerCase() === "true";

    if (!webhookUrl || !enabled) {
      console.log(
        `[slack-downtime-alert] ${new Date().toISOString()} skipped — webhook: ${!!webhookUrl}, enabled: ${enabled}`,
      );
      return json({ ok: true, skipped: true, alerted: 0, webhookConfigured: !!webhookUrl, enabled });
    }

    // Find unresolved events past the threshold that haven't been alerted yet
    const thresholdMs = ALERT_THRESHOLD_MIN * 60 * 1000;
    const now = Date.now();

    const { data: events, error } = await supabase
      .from("downtime_events")
      .select("id, console_name, downtime_type, reason, category, start_epoch, duration_ms, start_text, crew_name")
      .eq("resolved", false)
      .eq("slack_alerted", false);

    if (error) throw new Error(error.message);

    const overdue = (events ?? []).filter((e: DowntimeRow) => {
      const dur = e.duration_ms ?? (now - e.start_epoch);
      return dur >= thresholdMs;
    });

    if (overdue.length === 0) {
      console.log(`[slack-downtime-alert] ${new Date().toISOString()} no overdue events`);
      return json({ ok: true, alerted: 0 });
    }

    let alertedCount = 0;
    const failed: number[] = [];

    for (const evt of overdue) {
      const payload = buildSlackMessage(evt);
      const sent = await sendSlack(webhookUrl, payload);
      if (sent) {
        await supabase
          .from("downtime_events")
          .update({ slack_alerted: true, updated_at: new Date().toISOString() })
          .eq("id", evt.id);
        alertedCount++;
      } else {
        failed.push(evt.id);
      }
    }

    console.log(
      `[slack-downtime-alert] ${new Date().toISOString()} alerted=${alertedCount} failed=${failed.length}`,
    );
    return json({ ok: true, alerted: alertedCount, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[slack-downtime-alert] ${new Date().toISOString()} error:`, message);
    return json({ ok: false, error: message }, 502);
  }
});

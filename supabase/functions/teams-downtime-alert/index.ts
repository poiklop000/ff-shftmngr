// teams-downtime-alert — sends a Microsoft Teams notification as soon as a
// downtime event is detected.
//
// Designed to run on a schedule (every minute via pg_cron). On each run it:
//   1. Finds all unresolved downtime events that haven't been alerted yet
//   2. Posts a message to Teams via an incoming webhook URL
//   3. Marks each alerted event so it won't be sent again
//
// The webhook URL and enabled toggle are stored in the app_config table so they
// can be changed from the app's settings UI without redeploying.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
  resolved: boolean | null;
  end_epoch: number | null;
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

function buildTeamsMessage(evt: DowntimeRow): Record<string, unknown> {
  const nowMs = Date.now();
  const durationMs = evt.resolved
    ? (evt.duration_ms ?? (evt.end_epoch ? evt.end_epoch - evt.start_epoch : 0))
    : (evt.duration_ms ?? (nowMs - evt.start_epoch));
  const lineName = evt.console_name ?? "Production Line";
  const typeLabel = evt.downtime_type ?? "Downtime";
  const reason = evt.reason ?? "No reason recorded";
  const category = evt.category ?? "Uncategorised";
  const startTime = evt.start_text ?? new Date(evt.start_epoch).toISOString();
  const status = evt.resolved ? "ENDED" : "ONGOING";

  const facts: { title: string; value: string }[] = [
    { title: "Reason:", value: reason },
    { title: "Category:", value: category },
    { title: "Duration:", value: formatDuration(durationMs) },
    { title: "Started:", value: startTime },
  ];

  if (evt.crew_name) {
    facts.push({ title: "Crew:", value: evt.crew_name });
  }

  return {
    type: "AdaptiveCard",
    version: "1.2",
    body: [
      {
        type: "TextBlock",
        text: `Downtime Alert — ${lineName}`,
        weight: "Bolder",
        size: "Large",
      },
      {
        type: "TextBlock",
        text: `${typeLabel} downtime is ${status}.`,
        wrap: true,
        color: "Attention",
        weight: "Bolder",
      },
      {
        type: "FactSet",
        facts,
      },
      {
        type: "TextBlock",
        text: "— Sent automatically by Free-Flow Shift Manager Console",
        wrap: true,
        isSubtle: true,
        size: "Small",
      },
    ],
  };
}

async function sendTeams(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    console.error(
      `[teams-downtime-alert] webhook POST failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`,
    );
  }
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
      .eq("key", "teams_webhook_url")
      .maybeSingle();
    const webhookUrl = cfgRow?.value?.trim();

    // Read optional enabled flag (default to disabled if not set)
    const { data: enabledRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "teams_alerts_enabled")
      .maybeSingle();
    const enabled = enabledRow?.value?.toLowerCase() === "true";

    // Read alert threshold in minutes (default 10). Alerts only fire once a
    // downtime has been ongoing for at least this long, so short blips don't
    // trigger a notification.
    const { data: thresholdRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "teams_alert_threshold_minutes")
      .maybeSingle();
    const thresholdMinutes = Number(thresholdRow?.value);
    const thresholdMs = (Number.isFinite(thresholdMinutes) && thresholdMinutes > 0
      ? thresholdMinutes
      : 10) * 60_000;

    if (!webhookUrl || !enabled) {
      console.log(
        `[teams-downtime-alert] ${new Date().toISOString()} skipped — webhook: ${!!webhookUrl}, enabled: ${enabled}`,
      );
      return json({ ok: true, skipped: true, alerted: 0, webhookConfigured: !!webhookUrl, enabled });
    }

    // Find events that haven't been alerted yet. We include both:
    //   1. Unresolved events ongoing for >= threshold minutes, AND
    //   2. Recently-resolved events (resolved within the last 10 minutes)
    //      whose total duration was >= threshold minutes.
    // The second case catches downtimes that ended between cron ticks —
    // without it, a 14-minute downtime that gets resolved by the sync job
    // before this alert job runs would never trigger a notification.
    const nowMs = Date.now();
    // For resolved events, only consider those that ended within the last
    // 10 minutes — this avoids re-sending alerts for old historical events
    // while still catching downtimes that ended between cron ticks.
    const recentEndCutoffMs = nowMs - 10 * 60_000;

    const { data: events, error } = await supabase
      .from("downtime_events")
      .select("id, console_name, downtime_type, reason, category, start_epoch, duration_ms, start_text, crew_name, resolved, end_epoch")
      .eq("alert_sent", false)
      .or(`and(resolved.eq.false),and(resolved.eq.true,end_epoch.gte.${recentEndCutoffMs})`)
      .order("start_epoch", { ascending: false });

    if (error) throw new Error(error.message);

    if (!events || events.length === 0) {
      console.log(`[teams-downtime-alert] ${new Date().toISOString()} no unalerted events`);
      return json({ ok: true, alerted: 0 });
    }

    let alertedCount = 0;
    let skippedCount = 0;
    const failed: number[] = [];

    for (const evt of events) {
      // Only alert once the downtime has been ongoing for at least the
      // configured threshold. For unresolved events we measure elapsed time
      // from start to now; for resolved events we use the final duration.
      const effectiveDurationMs = evt.resolved
        ? (evt.duration_ms ?? (evt.end_epoch ? evt.end_epoch - evt.start_epoch : 0))
        : (nowMs - evt.start_epoch);
      if (effectiveDurationMs < thresholdMs) {
        skippedCount++;
        continue;
      }
      const payload = buildTeamsMessage(evt);
      const sent = await sendTeams(webhookUrl, payload);
      if (sent) {
        await supabase
          .from("downtime_events")
          .update({ alert_sent: true, updated_at: new Date().toISOString() })
          .eq("id", evt.id);
        alertedCount++;
      } else {
        failed.push(evt.id);
      }
    }

    console.log(
      `[teams-downtime-alert] ${new Date().toISOString()} alerted=${alertedCount} skipped=${skippedCount} failed=${failed.length}`,
    );
    return json({ ok: true, alerted: alertedCount, skipped: skippedCount, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[teams-downtime-alert] ${new Date().toISOString()} error:`, message);
    return json({ ok: false, error: message }, 502);
  }
});

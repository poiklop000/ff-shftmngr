// teams-downtime-alert — sends Microsoft Teams notifications for downtime events.
//
// Two alert types are supported:
//   1. OCCURRED — sent when an unresolved downtime has been ongoing for at least
//      the configured threshold. Tracked via the alert_sent column.
//   2. RESOLVED — sent when a downtime event ends. Tracked via the
//      resolved_alert_sent column. Only fires if the event lasted at least the
//      threshold, and includes the total duration.
//
// Designed to run on a schedule (every minute via pg_cron).
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
  alert_sent: boolean | null;
  resolved_alert_sent: boolean | null;
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

function buildOccurredMessage(evt: DowntimeRow): Record<string, unknown> {
  const nowMs = Date.now();
  const durationMs = evt.duration_ms ?? (nowMs - evt.start_epoch);
  const lineName = evt.console_name ?? "Production Line";
  const typeLabel = evt.downtime_type ?? "Downtime";
  const reason = evt.reason ?? "No reason recorded";
  const category = evt.category ?? "Uncategorised";
  const startTime = evt.start_text ?? new Date(evt.start_epoch).toISOString();

  const facts: { title: string; value: string }[] = [
    { title: "Reason:", value: reason },
    { title: "Category:", value: category },
    { title: "Duration so far:", value: formatDuration(durationMs) },
    { title: "Started:", value: startTime },
  ];
  if (evt.crew_name) facts.push({ title: "Crew:", value: evt.crew_name });

  return {
    type: "AdaptiveCard",
    version: "1.2",
    body: [
      { type: "TextBlock", text: `Downtime Started — ${lineName}`, weight: "Bolder", size: "Large" },
      { type: "TextBlock", text: `${typeLabel} downtime is ONGOING.`, wrap: true, color: "Attention", weight: "Bolder" },
      { type: "FactSet", facts },
      { type: "TextBlock", text: "— Sent automatically by Free-Flow Shift Manager Console", wrap: true, isSubtle: true, size: "Small" },
    ],
  };
}

function buildResolvedMessage(evt: DowntimeRow): Record<string, unknown> {
  const durationMs = evt.duration_ms ?? (evt.end_epoch ? evt.end_epoch - evt.start_epoch : 0);
  const lineName = evt.console_name ?? "Production Line";
  const typeLabel = evt.downtime_type ?? "Downtime";
  const reason = evt.reason ?? "No reason recorded";
  const category = evt.category ?? "Uncategorised";
  const startTime = evt.start_text ?? new Date(evt.start_epoch).toISOString();
  const endTime = evt.end_epoch ? new Date(evt.end_epoch).toISOString() : "Unknown";

  const facts: { title: string; value: string }[] = [
    { title: "Reason:", value: reason },
    { title: "Category:", value: category },
    { title: "Total duration:", value: formatDuration(durationMs) },
    { title: "Started:", value: startTime },
    { title: "Ended:", value: endTime },
  ];
  if (evt.crew_name) facts.push({ title: "Crew:", value: evt.crew_name });

  return {
    type: "AdaptiveCard",
    version: "1.2",
    body: [
      { type: "TextBlock", text: `Downtime Resolved — ${lineName}`, weight: "Bolder", size: "Large" },
      { type: "TextBlock", text: `${typeLabel} downtime has ENDED.`, wrap: true, color: "Good", weight: "Bolder" },
      { type: "FactSet", facts },
      { type: "TextBlock", text: "— Sent automatically by Free-Flow Shift Manager Console", wrap: true, isSubtle: true, size: "Small" },
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

    const { data: cfgRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "teams_webhook_url")
      .maybeSingle();
    const webhookUrl = cfgRow?.value?.trim();

    const { data: enabledRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "teams_alerts_enabled")
      .maybeSingle();
    const enabled = enabledRow?.value?.toLowerCase() === "true";

    const { data: thresholdRow } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "teams_alert_threshold_minutes")
      .maybeSingle();
    const thresholdMinutes = Number(thresholdRow?.value);
    const thresholdMs = (Number.isFinite(thresholdMinutes) && thresholdMinutes >= 0
      ? thresholdMinutes
      : 10) * 60_000;

    if (!webhookUrl || !enabled) {
      console.log(
        `[teams-downtime-alert] ${new Date().toISOString()} skipped — webhook: ${!!webhookUrl}, enabled: ${enabled}`,
      );
      return json({ ok: true, skipped: true, alerted: 0, webhookConfigured: !!webhookUrl, enabled });
    }

    const nowMs = Date.now();
    const recentEndCutoffMs = nowMs - 10 * 60_000;

    // Fetch events that need either an OCCURRED or RESOLVED alert.
    // Conditions:
    //   - OCCURRED alert needed: alert_sent = false AND unresolved AND ongoing >= threshold
    //   - RESOLVED alert needed: resolved_alert_sent = false AND resolved AND ended recently
    //     AND total duration >= threshold
    const { data: events, error } = await supabase
      .from("downtime_events")
      .select("id, console_name, downtime_type, reason, category, start_epoch, duration_ms, start_text, crew_name, resolved, end_epoch, alert_sent, resolved_alert_sent")
      .or(`and(alert_sent.eq.false,resolved.eq.false),and(resolved_alert_sent.eq.false,resolved.eq.true,end_epoch.gte.${recentEndCutoffMs})`)
      .order("start_epoch", { ascending: false });

    if (error) throw new Error(error.message);

    if (!events || events.length === 0) {
      console.log(`[teams-downtime-alert] ${new Date().toISOString()} no events needing alerts`);
      return json({ ok: true, alerted: 0 });
    }

    let occurredCount = 0;
    let resolvedCount = 0;
    let skippedCount = 0;
    const failed: number[] = [];

    for (const evt of events) {
      const needsOccurred = !evt.alert_sent && !evt.resolved;
      const needsResolved = !evt.resolved_alert_sent && evt.resolved;

      if (!needsOccurred && !needsResolved) {
        skippedCount++;
        continue;
      }

      // Duration check
      const effectiveDurationMs = evt.resolved
        ? (evt.duration_ms ?? (evt.end_epoch ? evt.end_epoch - evt.start_epoch : 0))
        : (nowMs - evt.start_epoch);

      if (effectiveDurationMs < thresholdMs) {
        skippedCount++;
        continue;
      }

      // Send the appropriate alert(s)
      if (needsOccurred) {
        const payload = buildOccurredMessage(evt);
        const sent = await sendTeams(webhookUrl, payload);
        if (sent) {
          await supabase
            .from("downtime_events")
            .update({ alert_sent: true, updated_at: new Date().toISOString() })
            .eq("id", evt.id);
          occurredCount++;
        } else {
          failed.push(evt.id);
        }
      }

      if (needsResolved) {
        const payload = buildResolvedMessage(evt);
        const sent = await sendTeams(webhookUrl, payload);
        if (sent) {
          await supabase
            .from("downtime_events")
            .update({ resolved_alert_sent: true, updated_at: new Date().toISOString() })
            .eq("id", evt.id);
          resolvedCount++;
        } else {
          failed.push(evt.id);
        }
      }
    }

    const totalAlerted = occurredCount + resolvedCount;
    console.log(
      `[teams-downtime-alert] ${new Date().toISOString()} occurred=${occurredCount} resolved=${resolvedCount} skipped=${skippedCount} failed=${failed.length}`,
    );
    return json({ ok: true, alerted: totalAlerted, occurred: occurredCount, resolved: resolvedCount, skipped: skippedCount, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[teams-downtime-alert] ${new Date().toISOString()} error:`, message);
    return json({ ok: false, error: message }, 502);
  }
});

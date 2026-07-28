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
  const durationMs = evt.duration_ms ?? (Date.now() - evt.start_epoch);
  const lineName = evt.console_name ?? "Production Line";
  const typeLabel = evt.downtime_type ?? "Downtime";
  const reason = evt.reason ?? "No reason recorded";
  const category = evt.category ?? "Uncategorised";
  const startTime = evt.start_text ?? new Date(evt.start_epoch).toISOString();

  const facts: { title: string; value: string }[] = [
    { title: "Reason", value: reason },
    { title: "Category", value: category },
    { title: "Duration", value: formatDuration(durationMs) },
    { title: "Started", value: startTime },
  ];

  if (evt.crew_name) {
    facts.push({ title: "Crew", value: evt.crew_name });
  }

  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: "",
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          {
            type: "TextBlock",
            text: `Downtime Alert — ${lineName}`,
            size: "Large",
            weight: "Bolder",
            color: "Attention",
            wrap: true,
          },
          {
            type: "TextBlock",
            text: `${typeLabel} downtime has occurred.`,
            size: "Medium",
            color: "Warning",
            wrap: true,
            spacing: "Small",
          },
          {
            type: "FactSet",
            facts,
            spacing: "Medium",
          },
          {
            type: "TextBlock",
            text: "Sent automatically by Free-Flow Shift Manager Console",
            size: "Small",
            isSubtle: true,
            wrap: true,
            spacing: "Medium",
          },
        ],
      },
    }],
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

    if (!webhookUrl || !enabled) {
      console.log(
        `[teams-downtime-alert] ${new Date().toISOString()} skipped — webhook: ${!!webhookUrl}, enabled: ${enabled}`,
      );
      return json({ ok: true, skipped: true, alerted: 0, webhookConfigured: !!webhookUrl, enabled });
    }

    // Find all unresolved events that haven't been alerted yet
    const { data: events, error } = await supabase
      .from("downtime_events")
      .select("id, console_name, downtime_type, reason, category, start_epoch, duration_ms, start_text, crew_name")
      .eq("resolved", false)
      .eq("alert_sent", false)
      .order("start_epoch", { ascending: false });

    if (error) throw new Error(error.message);

    if (!events || events.length === 0) {
      console.log(`[teams-downtime-alert] ${new Date().toISOString()} no unalerted events`);
      return json({ ok: true, alerted: 0 });
    }

    let alertedCount = 0;
    const failed: number[] = [];

    for (const evt of events) {
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
      `[teams-downtime-alert] ${new Date().toISOString()} alerted=${alertedCount} failed=${failed.length}`,
    );
    return json({ ok: true, alerted: alertedCount, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[teams-downtime-alert] ${new Date().toISOString()} error:`, message);
    return json({ ok: false, error: message }, 502);
  }
});

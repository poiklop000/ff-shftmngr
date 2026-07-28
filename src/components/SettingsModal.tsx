import { useCallback, useEffect, useState } from 'react';
import { X, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState('10');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: webhookRow } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'teams_webhook_url')
          .maybeSingle();
        const { data: enabledRow } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'teams_alerts_enabled')
          .maybeSingle();
        const { data: thresholdRow } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'teams_alert_threshold_minutes')
          .maybeSingle();
        if (cancelled) return;
        setWebhookUrl(webhookRow?.value ?? '');
        setEnabled(enabledRow?.value?.toLowerCase() === 'true');
        const parsedThreshold = parseInt(thresholdRow?.value ?? '10', 10);
        setThreshold(Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? String(parsedThreshold) : '10');
      } catch {
        if (!cancelled) setError('Could not load current settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const handleSave = useCallback(async () => {
    const trimmed = webhookUrl.trim();
    if (enabled && !trimmed) {
      setError('Paste a Microsoft Teams webhook URL before enabling alerts.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { error: webhookErr } = await supabase
        .from('app_config')
        .upsert({ key: 'teams_webhook_url', value: trimmed }, { onConflict: 'key' });
      if (webhookErr) throw new Error(webhookErr.message);
      const { error: enabledErr } = await supabase
        .from('app_config')
        .upsert({ key: 'teams_alerts_enabled', value: String(enabled) }, { onConflict: 'key' });
      if (enabledErr) throw new Error(enabledErr.message);
      const parsedThreshold = parseInt(threshold, 10);
      const safeThreshold = Number.isFinite(parsedThreshold) && parsedThreshold > 0 ? String(parsedThreshold) : '10';
      const { error: thresholdErr } = await supabase
        .from('app_config')
        .upsert({ key: 'teams_alert_threshold_minutes', value: safeThreshold }, { onConflict: 'key' });
      if (thresholdErr) throw new Error(thresholdErr.message);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [webhookUrl, enabled, threshold]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Microsoft Teams Alert Settings</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <p className="modal-loading">Loading settings…</p>
        ) : (
          <>
            <p className="modal-description">
              Get a Microsoft Teams message when a downtime event lasts longer than 10 minutes.
              Create an incoming webhook in your Teams channel (Apps → Workflows → Post to a channel
              when a webhook request is received), pick a channel, and paste the URL below.
            </p>

            <div className="input-group" style={{ maxWidth: '100%' }}>
              <label htmlFor="teams-webhook">Microsoft Teams Webhook URL</label>
              <input
                id="teams-webhook"
                type="url"
                className="form-control"
                placeholder="https://*.webhook.office.com/webhookb2/…"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>

            <div className="input-group" style={{ maxWidth: '100%' }}>
              <label htmlFor="teams-threshold">Alert threshold (minutes)</label>
              <input
                id="teams-threshold"
                type="number"
                min="1"
                className="form-control"
                placeholder="10"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
              <small style={{ display: 'block', marginTop: 6, color: 'var(--text-muted, #888)', fontSize: 12 }}>
                Alerts are only sent once a downtime has been ongoing for at least this many minutes.
              </small>
            </div>

            <label className="modal-toggle-row">
              <span>Enable Microsoft Teams alerts</span>
              <button
                type="button"
                className={`toggle-switch ${enabled ? 'on' : ''}`}
                onClick={() => setEnabled((v) => !v)}
                aria-pressed={enabled}
                aria-label="Toggle Microsoft Teams alerts"
              >
                <span className="toggle-switch-knob" />
              </button>
            </label>

            {error && (
              <div className="modal-status modal-status-error">
                <AlertCircle size={16} /> {error}
              </div>
            )}
            {saved && (
              <div className="modal-status modal-status-success">
                <CheckCircle2 size={16} /> Settings saved.
              </div>
            )}

            <div className="sm-btn-row" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="tab-btn tab-btn-blue"
                onClick={handleSave}
                disabled={saving}
              >
                <Send size={15} /> {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

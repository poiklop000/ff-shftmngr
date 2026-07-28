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
          .eq('key', 'slack_webhook_url')
          .maybeSingle();
        const { data: enabledRow } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'slack_alerts_enabled')
          .maybeSingle();
        if (cancelled) return;
        setWebhookUrl(webhookRow?.value ?? '');
        setEnabled(enabledRow?.value?.toLowerCase() === 'true');
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
      setError('Paste a Slack webhook URL before enabling alerts.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await supabase
        .from('app_config')
        .upsert({ key: 'slack_webhook_url', value: trimmed });
      await supabase
        .from('app_config')
        .upsert({ key: 'slack_alerts_enabled', value: String(enabled) });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Could not save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [webhookUrl, enabled]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Slack Alert Settings</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <p className="modal-loading">Loading settings…</p>
        ) : (
          <>
            <p className="modal-description">
              Get a Slack message when a downtime event lasts longer than 10 minutes.
              Create an incoming webhook in Slack (Apps → Incoming Webhooks), pick a channel,
              and paste the URL below.
            </p>

            <div className="input-group" style={{ maxWidth: '100%' }}>
              <label htmlFor="slack-webhook">Slack Webhook URL</label>
              <input
                id="slack-webhook"
                type="url"
                className="form-control"
                placeholder="https://hooks.slack.com/services/…"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>

            <label className="modal-toggle-row">
              <span>Enable Slack alerts</span>
              <button
                type="button"
                className={`toggle-switch ${enabled ? 'on' : ''}`}
                onClick={() => setEnabled((v) => !v)}
                aria-pressed={enabled}
                aria-label="Toggle Slack alerts"
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

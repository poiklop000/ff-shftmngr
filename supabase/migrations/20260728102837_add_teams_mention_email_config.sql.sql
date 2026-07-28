-- Add a config key for the email address to @mention in Teams alerts.
-- Teams requires an email to generate a <at> mention tag that triggers a notification.
INSERT INTO app_config (key, value)
VALUES ('teams_mention_email', '')
ON CONFLICT (key) DO NOTHING;
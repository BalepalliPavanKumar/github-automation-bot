const config = require("./config");

async function sendSlackNotification(text, fields = []) {
  if (!config.slack.webhookUrl) {
    return { skipped: true, reason: "SLACK_WEBHOOK_URL is not configured" };
  }

  const response = await fetch(config.slack.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text }
        },
        ...(fields.length
          ? [
              {
                type: "section",
                fields: fields.map((field) => ({
                  type: "mrkdwn",
                  text: `*${field.title}*\n${field.value}`
                }))
              }
            ]
          : [])
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Slack notification failed with ${response.status}`);
  }

  return { ok: true };
}

module.exports = { sendSlackNotification };

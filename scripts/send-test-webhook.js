const crypto = require("crypto");

const target = process.env.WEBHOOK_URL || "http://localhost:3000/webhooks/github";
const secret = process.env.GITHUB_WEBHOOK_SECRET || "dev-webhook-secret";
const eventType = process.env.GITHUB_EVENT || "issues";
const deliveryId = process.env.GITHUB_DELIVERY || crypto.randomUUID();

const payload = {
  action: "opened",
  repository: {
    full_name: process.env.GITHUB_REPOSITORY || "demo/repo",
    html_url: "https://github.com/demo/repo"
  },
  sender: {
    login: "demo-user"
  },
  issue: {
    number: 1,
    title: process.env.GITHUB_TITLE || "bug: sample issue",
    body: "This is a signed local test payload.",
    html_url: "https://github.com/demo/repo/issues/1"
  }
};

const body = JSON.stringify(payload);
const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

fetch(target, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-GitHub-Event": eventType,
    "X-GitHub-Delivery": deliveryId,
    "X-Hub-Signature-256": signature
  },
  body
})
  .then(async (response) => {
    const text = await response.text();
    console.log(response.status, text);
    if (!response.ok) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

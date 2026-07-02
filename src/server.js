const express = require("express");
const cookieSession = require("cookie-session");
const helmet = require("helmet");
const morgan = require("morgan");
const config = require("./config");
const store = require("./store");
const github = require("./github");
const { sendSlackNotification } = require("./slack");

const app = express();
const sseClients = new Set();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("combined"));
app.use(
  cookieSession({
    name: "session",
    secret: config.sessionSecret,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  })
);

app.post(
  "/webhooks/github",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const signature = req.header("x-hub-signature-256");
    const deliveryId = req.header("x-github-delivery");
    const eventType = req.header("x-github-event");

    if (!deliveryId || !github.verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: "Invalid GitHub webhook signature" });
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    const normalized = normalizeEvent(deliveryId, eventType, payload);
    const { event, created } = await store.recordEvent(normalized);

    if (!created) {
      return res.status(202).json({ ok: true, duplicate: true });
    }

    res.status(202).json({ ok: true });

    processEvent(event).catch(async (error) => {
      await store.updateEventStatus(event.id, "failed", error.message);
      await store.recordAction({
        event_id: event.id,
        type: "process",
        status: "failed",
        details: "Unhandled webhook processing failure",
        error: error.message
      });
      publishEvent(event.repo_full_name);
    });
  }
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/dashboard.html", requirePageUser, (req, res) => {
  res.sendFile("dashboard.html", { root: "public" });
});

app.use(express.static("public"));

app.get("/auth/github", (req, res) => {
  const state = github.createState();
  req.session.oauthState = state;
  res.redirect(github.oauthAuthorizeUrl(state));
});

app.get("/auth/github/callback", async (req, res, next) => {
  try {
    if (!req.query.state || req.query.state !== req.session.oauthState) {
      return res.status(400).send("OAuth state mismatch.");
    }
    const token = await github.exchangeCodeForToken(req.query.code);
    const viewer = await github.getViewer(token);
    const user = await store.upsertUser({
      github_id: String(viewer.id),
      login: viewer.login,
      avatar_url: viewer.avatar_url,
      access_token: token
    });
    req.session = { userId: user.id };
    res.redirect("/dashboard.html");
  } catch (error) {
    next(error);
  }
});

app.post("/auth/logout", (req, res) => {
  req.session = null;
  res.redirect("/");
});

app.get("/api/me", requireUser, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/github/repos", requireUser, async (req, res, next) => {
  try {
    const repos = await github.listRepositories(req.user.access_token);
    res.json({
      repos: repos.map((repo) => ({
        id: repo.id,
        full_name: repo.full_name,
        private: repo.private,
        html_url: repo.html_url
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/repositories", requireUser, async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || "");
    if (!/^[^/]+\/[^/]+$/.test(fullName)) {
      return res.status(400).json({ error: "Repository must be in owner/name format" });
    }

    const hook = await github.createRepositoryWebhook(req.user.access_token, fullName);
    const repo = await store.upsertRepository({
      user_id: req.user.id,
      full_name: fullName,
      webhook_id: String(hook.id)
    });
    res.status(201).json({ repo });
  } catch (error) {
    next(error);
  }
});

app.get("/api/repositories", requireUser, async (req, res) => {
  const repos = await store.listRepositories(req.user.id);
  res.json({ repos });
});

app.get("/api/events", requireUser, async (req, res) => {
  const events = await store.listEvents(req.user.id);
  res.json({ events });
});

app.get("/api/events/stream", requireUser, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write("event: ready\ndata: {}\n\n");
  const client = { userId: req.user.id, res };
  sseClients.add(client);
  req.on("close", () => sseClients.delete(client));
});

app.get("/api/rules", requireUser, async (req, res) => {
  const rules = await store.listRules(req.user.id);
  res.json({ rules });
});

app.post("/api/rules", requireUser, async (req, res) => {
  const eventType = String(req.body.event_type || "issues");
  const keyword = String(req.body.keyword || "").trim();
  const label = String(req.body.label || "").trim();
  const comment = String(req.body.comment || "").trim();
  const notifySlack = req.body.notify_slack !== false;

  if (!["issues", "pull_request", "push"].includes(eventType)) {
    return res.status(400).json({ error: "Unsupported event type" });
  }
  if (!keyword) {
    return res.status(400).json({ error: "Keyword is required" });
  }
  if (!label && !comment && !notifySlack) {
    return res.status(400).json({ error: "Choose at least one action" });
  }

  const rule = await store.createRule({
    user_id: req.user.id,
    event_type: eventType,
    keyword,
    label,
    comment,
    notify_slack: notifySlack
  });
  res.status(201).json({ rule });
});

app.delete("/api/rules/:id", requireUser, async (req, res) => {
  await store.deleteRule(req.user.id, req.params.id);
  res.status(204).end();
});

app.use((error, req, res, next) => {
  console.error(JSON.stringify({ level: "error", message: error.message, path: req.path }));
  res.status(500).json({ error: error.message });
});

async function requireUser(req, res, next) {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await store.getUser(req.session.userId);
    if (!user) {
      req.session = null;
      return res.status(401).json({ error: "Authentication required" });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function requirePageUser(req, res, next) {
  try {
    if (!req.session?.userId) {
      return res.redirect("/");
    }
    const user = await store.getUser(req.session.userId);
    if (!user) {
      req.session = null;
      return res.redirect("/");
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function normalizeEvent(deliveryId, eventType, payload) {
  const issueLike = payload.issue || payload.pull_request;
  return {
    delivery_id: deliveryId,
    event_type: eventType,
    action: payload.action || "received",
    repo_full_name: payload.repository?.full_name || "unknown/unknown",
    sender_login: payload.sender?.login || "",
    issue_number: issueLike?.number || null,
    title: issueLike?.title || payload.head_commit?.message || `${eventType} event`,
    url: issueLike?.html_url || payload.compare || payload.repository?.html_url || "",
    payload
  };
}

async function processEvent(event) {
  const rules = await store.listEnabledRulesForRepo(event.repo_full_name);
  const matchingRules = rules.filter((rule) => ruleMatches(rule, event));

  if (!matchingRules.length) {
    await store.updateEventStatus(event.id, "ignored");
    await store.recordAction({
      event_id: event.id,
      type: "rules",
      status: "ignored",
      details: "No enabled rule matched this event"
    });
    publishEvent(event.repo_full_name);
    return;
  }

  const user = await store.findUserByRepo(event.repo_full_name);
  if (!user) {
    throw new Error(`No connected user found for ${event.repo_full_name}`);
  }

  for (const rule of matchingRules) {
    await applyRule(user, event, rule);
  }

  await store.updateEventStatus(event.id, "processed");
  publishEvent(event.repo_full_name);
}

function ruleMatches(rule, event) {
  if (rule.event_type !== event.event_type) return false;
  const haystack = [
    event.title,
    event.sender_login,
    event.action,
    event.payload?.issue?.body,
    event.payload?.pull_request?.body,
    event.payload?.head_commit?.message
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(String(rule.keyword).toLowerCase());
}

async function applyRule(user, event, rule) {
  if (rule.label && event.issue_number && ["issues", "pull_request"].includes(event.event_type)) {
    await runAction(event.id, "github_label", `Add label "${rule.label}"`, () =>
      github.addIssueLabel(user.access_token, event.repo_full_name, event.issue_number, rule.label)
    );
  }

  if (rule.comment && event.issue_number && ["issues", "pull_request"].includes(event.event_type)) {
    await runAction(event.id, "github_comment", "Post GitHub comment", () =>
      github.commentOnIssue(user.access_token, event.repo_full_name, event.issue_number, rule.comment)
    );
  }

  if (rule.notify_slack) {
    await runAction(event.id, "slack", "Send Slack notification", () =>
      sendSlackNotification(`GitHub bot matched *${rule.keyword}* on ${event.repo_full_name}`, [
        { title: "Event", value: `${event.event_type}.${event.action}` },
        { title: "Title", value: event.title || "Untitled" },
        { title: "Sender", value: event.sender_login || "Unknown" },
        { title: "URL", value: event.url || "No URL" }
      ])
    );
  }
}

async function runAction(eventId, type, details, fn) {
  try {
    await fn();
    await store.recordAction({ event_id: eventId, type, status: "succeeded", details });
  } catch (error) {
    await store.recordAction({ event_id: eventId, type, status: "failed", details, error: error.message });
    throw error;
  }
}

async function publishEvent(repoFullName) {
  for (const client of sseClients) {
    const repos = await store.listRepositories(client.userId);
    if (repos.some((repo) => repo.full_name === repoFullName)) {
      client.res.write(`event: events\ndata: ${JSON.stringify({ changed: true })}\n\n`);
    }
  }
}

function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    avatar_url: user.avatar_url
  };
}

store.init().then(() => {
  app.listen(config.port, () => {
    console.log(`GitHub automation bot listening on ${config.port}`);
  });
});

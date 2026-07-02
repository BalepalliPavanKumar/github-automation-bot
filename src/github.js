const crypto = require("crypto");
const config = require("./config");

const GITHUB_API = "https://api.github.com";

function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", config.github.webhookSecret)
    .update(rawBody)
    .digest("hex")}`;

  const provided = Buffer.from(signatureHeader);
  const calculated = Buffer.from(expected);

  return provided.length === calculated.length && crypto.timingSafeEqual(provided, calculated);
}

function createState() {
  return crypto.randomBytes(24).toString("hex");
}

function oauthAuthorizeUrl(state) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.github.clientId);
  url.searchParams.set("redirect_uri", `${config.appBaseUrl}/auth/github/callback`);
  url.searchParams.set("scope", "repo read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCodeForToken(code) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: `${config.appBaseUrl}/auth/github/callback`
    })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error_description || "GitHub OAuth token exchange failed");
  }
  return data.access_token;
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || `GitHub API request failed with ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function getViewer(token) {
  return githubRequest("/user", token);
}

async function listRepositories(token) {
  return githubRequest("/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100", token);
}

async function createRepositoryWebhook(token, fullName) {
  const [owner, repo] = fullName.split("/");
  return githubRequest(`/repos/${owner}/${repo}/hooks`, token, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["issues", "pull_request", "push"],
      config: {
        url: `${config.appBaseUrl}/webhooks/github`,
        content_type: "json",
        secret: config.github.webhookSecret,
        insecure_ssl: "0"
      }
    })
  });
}

async function addIssueLabel(token, repoFullName, issueNumber, label) {
  const [owner, repo] = repoFullName.split("/");
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, token, {
    method: "POST",
    body: JSON.stringify({ labels: [label] })
  });
}

async function commentOnIssue(token, repoFullName, issueNumber, body) {
  const [owner, repo] = repoFullName.split("/");
  return githubRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, {
    method: "POST",
    body: JSON.stringify({ body })
  });
}

module.exports = {
  addIssueLabel,
  commentOnIssue,
  createRepositoryWebhook,
  createState,
  exchangeCodeForToken,
  getViewer,
  listRepositories,
  oauthAuthorizeUrl,
  verifyWebhookSignature
};

const state = {
  user: null,
  repos: [],
  connected: [],
  rules: [],
  events: []
};

const els = {
  avatar: document.querySelector("#avatar"),
  login: document.querySelector("#login"),
  repoSelect: document.querySelector("#repoSelect"),
  repoForm: document.querySelector("#repoForm"),
  refreshRepos: document.querySelector("#refreshRepos"),
  connectedRepos: document.querySelector("#connectedRepos"),
  ruleForm: document.querySelector("#ruleForm"),
  rules: document.querySelector("#rules"),
  events: document.querySelector("#events"),
  refreshEvents: document.querySelector("#refreshEvents"),
  eventTemplate: document.querySelector("#eventTemplate")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    window.location.href = "/";
    return null;
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function init() {
  const me = await api("/api/me");
  if (!me) return;
  state.user = me.user;
  els.avatar.src = state.user.avatar_url;
  els.login.textContent = state.user.login;
  await Promise.all([loadConnectedRepos(), loadRules(), loadEvents()]);
  openEventStream();
}

async function loadAvailableRepos() {
  els.repoSelect.innerHTML = '<option value="">Loading...</option>';
  const { repos } = await api("/api/github/repos");
  state.repos = repos;
  renderRepoSelect();
}

async function loadConnectedRepos() {
  const { repos } = await api("/api/repositories");
  state.connected = repos;
  renderConnectedRepos();
}

async function loadRules() {
  const { rules } = await api("/api/rules");
  state.rules = rules;
  renderRules();
}

async function loadEvents() {
  const { events } = await api("/api/events");
  state.events = events;
  renderEvents();
}

function renderRepoSelect() {
  els.repoSelect.innerHTML = '<option value="">Choose a repository</option>';
  for (const repo of state.repos) {
    const option = document.createElement("option");
    option.value = repo.full_name;
    option.textContent = repo.private ? `${repo.full_name} (private)` : repo.full_name;
    els.repoSelect.append(option);
  }
}

function renderConnectedRepos() {
  els.connectedRepos.innerHTML = "";
  if (!state.connected.length) {
    els.connectedRepos.innerHTML = '<li class="muted">No repositories connected yet.</li>';
    return;
  }
  for (const repo of state.connected) {
    const li = document.createElement("li");
    li.textContent = repo.full_name;
    els.connectedRepos.append(li);
  }
}

function renderRules() {
  els.rules.innerHTML = "";
  if (!state.rules.length) {
    els.rules.innerHTML = '<li class="muted">No rules yet. Add one like issues + bug + bug label.</li>';
    return;
  }
  for (const rule of state.rules) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span><strong>${escapeHtml(rule.event_type)}</strong> contains "${escapeHtml(rule.keyword)}"</span>
      <small>${rule.label ? `label: ${escapeHtml(rule.label)}` : ""} ${rule.notify_slack ? "Slack" : ""}</small>
      <button class="danger" data-rule-id="${rule.id}" type="button">Delete</button>
    `;
    els.rules.append(li);
  }
}

function renderEvents() {
  els.events.innerHTML = "";
  if (!state.events.length) {
    els.events.innerHTML = '<p class="muted">Webhook events will appear here after GitHub sends them.</p>';
    return;
  }

  for (const event of state.events) {
    const row = els.eventTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".status").textContent = event.status;
    row.querySelector(".status").dataset.status = event.status;
    row.querySelector("h3").textContent = event.title || "Untitled event";
    row.querySelector("p").textContent = `${event.event_type}.${event.action} in ${event.repo_full_name} by ${event.sender_login || "unknown"}`;
    const link = row.querySelector("a");
    link.href = event.url || "#";
    link.textContent = event.url ? "Open in GitHub" : "";
    const actions = row.querySelector("ul");
    for (const action of event.actions || []) {
      const li = document.createElement("li");
      li.textContent = `${action.type}: ${action.status}${action.error ? ` (${action.error})` : ""}`;
      actions.append(li);
    }
    els.events.append(row);
  }
}

function openEventStream() {
  const stream = new EventSource("/api/events/stream");
  stream.addEventListener("events", () => loadEvents().catch(showError));
}

function showError(error) {
  alert(error.message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.refreshRepos.addEventListener("click", () => loadAvailableRepos().catch(showError));
els.refreshEvents.addEventListener("click", () => loadEvents().catch(showError));

els.repoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/repositories", {
    method: "POST",
    body: JSON.stringify({ full_name: els.repoSelect.value })
  });
  await loadConnectedRepos();
});

els.ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.ruleForm);
  await api("/api/rules", {
    method: "POST",
    body: JSON.stringify({
      event_type: form.get("event_type"),
      keyword: form.get("keyword"),
      label: form.get("label"),
      comment: form.get("comment"),
      notify_slack: form.get("notify_slack") === "on"
    })
  });
  els.ruleForm.reset();
  els.ruleForm.notify_slack.checked = true;
  await loadRules();
});

els.rules.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-rule-id]");
  if (!button) return;
  await api(`/api/rules/${button.dataset.ruleId}`, { method: "DELETE" });
  await loadRules();
});

init().catch(showError);

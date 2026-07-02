const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");
const config = require("./config");

const dataPath = path.join(process.cwd(), ".data", "app.json");

function now() {
  return new Date().toISOString();
}

function defaultData() {
  return {
    users: [],
    repos: [],
    events: [],
    actions: [],
    rules: []
  };
}

class JsonStore {
  async init() {
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    try {
      await fs.access(dataPath);
    } catch {
      await fs.writeFile(dataPath, JSON.stringify(defaultData(), null, 2));
    }
  }

  async read() {
    const content = await fs.readFile(dataPath, "utf8");
    return JSON.parse(content);
  }

  async write(data) {
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
  }

  async upsertUser(user) {
    const data = await this.read();
    const existing = data.users.find((item) => item.github_id === user.github_id);
    if (existing) {
      Object.assign(existing, user, { updated_at: now() });
      await this.write(data);
      return existing;
    }
    const created = { id: cryptoId(), created_at: now(), updated_at: now(), ...user };
    data.users.push(created);
    await this.write(data);
    return created;
  }

  async getUser(id) {
    const data = await this.read();
    return data.users.find((user) => user.id === id) || null;
  }

  async findUserByRepo(repoFullName) {
    const data = await this.read();
    const repo = data.repos.find((item) => item.full_name === repoFullName);
    if (!repo) return null;
    return data.users.find((user) => user.id === repo.user_id) || null;
  }

  async upsertRepository(repo) {
    const data = await this.read();
    const existing = data.repos.find((item) => item.full_name === repo.full_name && item.user_id === repo.user_id);
    if (existing) {
      Object.assign(existing, repo, { updated_at: now() });
      await this.write(data);
      return existing;
    }
    const created = { id: cryptoId(), created_at: now(), updated_at: now(), ...repo };
    data.repos.push(created);
    await this.write(data);
    return created;
  }

  async listRepositories(userId) {
    const data = await this.read();
    return data.repos.filter((repo) => repo.user_id === userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async recordEvent(event) {
    const data = await this.read();
    const existing = data.events.find((item) => item.delivery_id === event.delivery_id);
    if (existing) return { event: existing, created: false };
    const created = {
      id: cryptoId(),
      received_at: now(),
      status: "received",
      ...event
    };
    data.events.push(created);
    await this.write(data);
    return { event: created, created: true };
  }

  async updateEventStatus(id, status, error = "") {
    const data = await this.read();
    const event = data.events.find((item) => item.id === id);
    if (event) {
      event.status = status;
      event.error = error;
      event.updated_at = now();
      await this.write(data);
    }
  }

  async recordAction(action) {
    const data = await this.read();
    const created = { id: cryptoId(), created_at: now(), ...action };
    data.actions.push(created);
    await this.write(data);
    return created;
  }

  async listEvents(userId, limit = 50) {
    const data = await this.read();
    const repos = data.repos.filter((repo) => repo.user_id === userId).map((repo) => repo.full_name);
    return data.events
      .filter((event) => repos.includes(event.repo_full_name))
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
      .slice(0, limit)
      .map((event) => ({
        ...event,
        actions: data.actions.filter((action) => action.event_id === event.id)
      }));
  }

  async createRule(rule) {
    const data = await this.read();
    const created = { id: cryptoId(), enabled: true, created_at: now(), ...rule };
    data.rules.push(created);
    await this.write(data);
    return created;
  }

  async listRules(userId) {
    const data = await this.read();
    return data.rules.filter((rule) => rule.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async listEnabledRulesForRepo(repoFullName) {
    const data = await this.read();
    const repo = data.repos.find((item) => item.full_name === repoFullName);
    if (!repo) return [];
    return data.rules.filter((rule) => rule.user_id === repo.user_id && rule.enabled);
  }

  async deleteRule(userId, ruleId) {
    const data = await this.read();
    data.rules = data.rules.filter((rule) => !(rule.id === ruleId && rule.user_id === userId));
    await this.write(data);
  }
}

class PgStore {
  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    });
  }

  async init() {
    await this.pool.query(`
      create table if not exists users (
        id text primary key,
        github_id text unique not null,
        login text not null,
        avatar_url text,
        access_token text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists repositories (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        full_name text not null,
        webhook_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(user_id, full_name)
      );
      create table if not exists events (
        id text primary key,
        delivery_id text unique not null,
        event_type text not null,
        action text,
        repo_full_name text not null,
        sender_login text,
        issue_number integer,
        title text,
        url text,
        payload jsonb not null,
        status text not null default 'received',
        error text,
        received_at timestamptz not null default now(),
        updated_at timestamptz
      );
      create table if not exists actions (
        id text primary key,
        event_id text not null references events(id) on delete cascade,
        type text not null,
        status text not null,
        details text,
        error text,
        created_at timestamptz not null default now()
      );
      create table if not exists rules (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        event_type text not null,
        keyword text not null,
        label text,
        comment text,
        notify_slack boolean not null default true,
        enabled boolean not null default true,
        created_at timestamptz not null default now()
      );
    `);
  }

  async upsertUser(user) {
    const id = user.id || cryptoId();
    const result = await this.pool.query(
      `insert into users (id, github_id, login, avatar_url, access_token)
       values ($1, $2, $3, $4, $5)
       on conflict (github_id) do update set
         login = excluded.login,
         avatar_url = excluded.avatar_url,
         access_token = excluded.access_token,
         updated_at = now()
       returning *`,
      [id, user.github_id, user.login, user.avatar_url, user.access_token]
    );
    return result.rows[0];
  }

  async getUser(id) {
    const result = await this.pool.query("select * from users where id = $1", [id]);
    return result.rows[0] || null;
  }

  async findUserByRepo(repoFullName) {
    const result = await this.pool.query(
      `select users.* from users
       join repositories on repositories.user_id = users.id
       where repositories.full_name = $1
       limit 1`,
      [repoFullName]
    );
    return result.rows[0] || null;
  }

  async upsertRepository(repo) {
    const result = await this.pool.query(
      `insert into repositories (id, user_id, full_name, webhook_id)
       values ($1, $2, $3, $4)
       on conflict (user_id, full_name) do update set
         webhook_id = excluded.webhook_id,
         updated_at = now()
       returning *`,
      [cryptoId(), repo.user_id, repo.full_name, repo.webhook_id]
    );
    return result.rows[0];
  }

  async listRepositories(userId) {
    const result = await this.pool.query("select * from repositories where user_id = $1 order by updated_at desc", [userId]);
    return result.rows;
  }

  async recordEvent(event) {
    const result = await this.pool.query(
      `insert into events (id, delivery_id, event_type, action, repo_full_name, sender_login, issue_number, title, url, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (delivery_id) do nothing
       returning *`,
      [
        cryptoId(),
        event.delivery_id,
        event.event_type,
        event.action,
        event.repo_full_name,
        event.sender_login,
        event.issue_number,
        event.title,
        event.url,
        event.payload
      ]
    );
    if (result.rows[0]) return { event: result.rows[0], created: true };
    const existing = await this.pool.query("select * from events where delivery_id = $1", [event.delivery_id]);
    return { event: existing.rows[0], created: false };
  }

  async updateEventStatus(id, status, error = "") {
    await this.pool.query("update events set status = $2, error = $3, updated_at = now() where id = $1", [id, status, error]);
  }

  async recordAction(action) {
    const result = await this.pool.query(
      `insert into actions (id, event_id, type, status, details, error)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [cryptoId(), action.event_id, action.type, action.status, action.details, action.error]
    );
    return result.rows[0];
  }

  async listEvents(userId, limit = 50) {
    const result = await this.pool.query(
      `select events.*, coalesce(json_agg(actions.*) filter (where actions.id is not null), '[]') as actions
       from events
       join repositories on repositories.full_name = events.repo_full_name
       left join actions on actions.event_id = events.id
       where repositories.user_id = $1
       group by events.id
       order by events.received_at desc
       limit $2`,
      [userId, limit]
    );
    return result.rows;
  }

  async createRule(rule) {
    const result = await this.pool.query(
      `insert into rules (id, user_id, event_type, keyword, label, comment, notify_slack)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [cryptoId(), rule.user_id, rule.event_type, rule.keyword, rule.label, rule.comment, rule.notify_slack]
    );
    return result.rows[0];
  }

  async listRules(userId) {
    const result = await this.pool.query("select * from rules where user_id = $1 order by created_at desc", [userId]);
    return result.rows;
  }

  async listEnabledRulesForRepo(repoFullName) {
    const result = await this.pool.query(
      `select rules.* from rules
       join repositories on repositories.user_id = rules.user_id
       where repositories.full_name = $1 and rules.enabled = true`,
      [repoFullName]
    );
    return result.rows;
  }

  async deleteRule(userId, ruleId) {
    await this.pool.query("delete from rules where id = $1 and user_id = $2", [ruleId, userId]);
  }
}

function cryptoId() {
  return require("crypto").randomUUID();
}

module.exports = config.databaseUrl ? new PgStore() : new JsonStore();

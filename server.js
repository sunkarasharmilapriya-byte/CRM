const { createHash, randomBytes, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.CRM_DB_PATH || path.join(__dirname, "crm.sqlite");
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, "public");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity TEXT NOT NULL CHECK (entity IN ('contacts', 'companies', 'leads', 'deals', 'tasks', 'activities')),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS records_owner_entity ON records(owner_id, entity, updated_at DESC);
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
`);

const entities = {
  contacts: {
    required: ["name"],
    fields: ["name", "email", "phone", "company", "title", "status", "source", "notes"],
  },
  companies: {
    required: ["name"],
    fields: ["name", "industry", "website", "phone", "location", "size", "notes"],
  },
  leads: {
    required: ["name"],
    fields: ["name", "company", "email", "phone", "source", "status", "value", "owner", "notes"],
  },
  deals: {
    required: ["name"],
    fields: ["name", "company", "contact", "value", "stage", "closeDate", "probability", "owner", "notes"],
  },
  tasks: {
    required: ["title"],
    fields: ["title", "dueDate", "priority", "status", "relatedTo", "assignee", "notes"],
  },
  activities: {
    required: ["title"],
    fields: ["title", "type", "date", "relatedTo", "description"],
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cleanText(value, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function serializeRecord(row) {
  return {
    id: row.id,
    ...(row.entity ? { entity: row.entity } : {}),
    ...JSON.parse(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authenticate(request) {
  const token = parseCookies(request).crm_session;
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = db.prepare(`
    SELECT users.id, users.name, users.email, sessions.token_hash
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now());
  if (!session) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return session;
}

function sessionCookie(token, maxAge) {
  return `crm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function handleApi(request, response, url) {
  const method = request.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readBody(request);
    const name = cleanText(body.name, 100);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 256) {
      return sendJson(response, 400, { error: "Enter your name, a valid email, and a password with at least 10 characters." });
    }
    const salt = randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64);
    let result;
    try {
      result = db.prepare("INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)")
        .run(name, email, Buffer.from(passwordHash).toString("hex"), salt.toString("hex"));
    } catch (error) {
      if (error.code === "ERR_SQLITE_ERROR" && error.message.includes("UNIQUE")) {
        return sendJson(response, 409, { error: "An account with that email already exists." });
      }
      throw error;
    }
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(createHash("sha256").update(token).digest("hex"), result.lastInsertRowid, Date.now() + SESSION_TTL);
    return sendJson(response, 201, { user: { id: result.lastInsertRowid, name, email } }, {
      "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000),
    });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(request);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const user = db.prepare("SELECT id, name, email, password_hash, password_salt FROM users WHERE email = ?").get(email);
    const candidate = user
      ? Buffer.from(await scrypt(password, Buffer.from(user.password_salt, "hex"), 64))
      : Buffer.alloc(64);
    const expected = user ? Buffer.from(user.password_hash, "hex") : Buffer.alloc(64);
    if (!user || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      return sendJson(response, 401, { error: "Email or password is incorrect." });
    }
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(createHash("sha256").update(token).digest("hex"), user.id, Date.now() + SESSION_TTL);
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    return sendJson(response, 200, { user: { id: user.id, name: user.name, email: user.email } }, {
      "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000),
    });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(request).crm_session;
    if (token) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .run(createHash("sha256").update(token).digest("hex"));
    }
    return sendJson(response, 200, { ok: true }, {
      "Set-Cookie": sessionCookie("", 0),
    });
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const user = await authenticate(request);
    if (!user) return sendJson(response, 200, { user: null });
    return sendJson(response, 200, { user: { id: user.id, name: user.name, email: user.email } });
  }

  const user = await authenticate(request);
  if (!user) return sendJson(response, 401, { error: "Please sign in to continue." });

  if (method === "GET" && pathname === "/api/dashboard") {
    const allRecords = db.prepare("SELECT id, entity, data, created_at, updated_at FROM records WHERE owner_id = ? ORDER BY updated_at DESC")
      .all(user.id).map(serializeRecord);
    const grouped = Object.fromEntries(Object.keys(entities).map((entity) => [entity, allRecords.filter((record) => record.entity === entity)]));
    const openDeals = grouped.deals.filter((deal) => deal.stage !== "Won" && deal.stage !== "Lost");
    const thisMonth = new Date();
    const monthPrefix = `${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}`;
    return sendJson(response, 200, {
      counts: Object.fromEntries(Object.keys(entities).map((entity) => [entity, grouped[entity].length])),
      openTasks: grouped.tasks.filter((task) => task.status !== "Done").length,
      pipelineValue: openDeals.reduce((total, deal) => total + (Number(deal.value) || 0), 0),
      wonThisMonth: grouped.deals.filter((deal) => deal.stage === "Won" && deal.updatedAt.startsWith(monthPrefix))
        .reduce((total, deal) => total + (Number(deal.value) || 0), 0),
      dealsByStage: ["Qualified", "Proposal", "Negotiation", "Won", "Lost"].map((stage) => ({
        stage,
        count: grouped.deals.filter((deal) => deal.stage === stage).length,
        value: grouped.deals.filter((deal) => deal.stage === stage).reduce((total, deal) => total + (Number(deal.value) || 0), 0),
      })),
      recentLeads: grouped.leads.slice(0, 5),
      upcomingTasks: grouped.tasks.filter((task) => task.status !== "Done").slice(0, 5),
      recentActivities: grouped.activities.slice(0, 5),
    });
  }

  const match = pathname.match(/^\/api\/(contacts|companies|leads|deals|tasks|activities)(?:\/(\d+))?$/);
  if (!match) return sendJson(response, 404, { error: "API route not found." });
  const [, entity, id] = match;
  const config = entities[entity];

  if (method === "GET" && !id) {
    const search = cleanText(url.searchParams.get("search") || "", 100).toLowerCase();
    const records = db.prepare("SELECT id, data, created_at, updated_at FROM records WHERE owner_id = ? AND entity = ? ORDER BY updated_at DESC")
      .all(user.id, entity).map(serializeRecord);
    const filtered = search
      ? records.filter((record) => Object.values(record).some((value) => String(value).toLowerCase().includes(search)))
      : records;
    return sendJson(response, 200, { records: filtered });
  }

  if (method === "POST" && !id) {
    const body = await readBody(request);
    const data = Object.fromEntries(config.fields.map((field) => {
      const value = body[field];
      return [field, field === "value" || field === "probability"
        ? (value === "" || value == null ? 0 : Math.max(0, Math.min(1000000000, Number(value) || 0)))
        : cleanText(value, field === "notes" || field === "description" ? 5000 : 300)];
    }));
    if (config.required.some((field) => !data[field])) {
      return sendJson(response, 400, { error: `Please provide ${config.required.join(" and ")}.` });
    }
    const result = db.prepare("INSERT INTO records (owner_id, entity, data) VALUES (?, ?, ?)")
      .run(user.id, entity, JSON.stringify(data));
    const record = db.prepare("SELECT id, data, created_at, updated_at FROM records WHERE id = ?").get(result.lastInsertRowid);
    return sendJson(response, 201, { record: serializeRecord(record) });
  }

  if (method === "PUT" && id) {
    const existing = db.prepare("SELECT id, data FROM records WHERE id = ? AND owner_id = ? AND entity = ?")
      .get(Number(id), user.id, entity);
    if (!existing) return sendJson(response, 404, { error: "Record not found." });
    const body = await readBody(request);
    const current = JSON.parse(existing.data);
    const data = Object.fromEntries(config.fields.map((field) => {
      if (!(field in body)) return [field, current[field] || ""];
      const value = body[field];
      return [field, field === "value" || field === "probability"
        ? (value === "" || value == null ? 0 : Math.max(0, Math.min(1000000000, Number(value) || 0)))
        : cleanText(value, field === "notes" || field === "description" ? 5000 : 300)];
    }));
    if (config.required.some((field) => !data[field])) {
      return sendJson(response, 400, { error: `Please provide ${config.required.join(" and ")}.` });
    }
    db.prepare("UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?")
      .run(JSON.stringify(data), Number(id), user.id);
    const record = db.prepare("SELECT id, data, created_at, updated_at FROM records WHERE id = ?").get(Number(id));
    return sendJson(response, 200, { record: serializeRecord(record) });
  }

  if (method === "DELETE" && id) {
    const result = db.prepare("DELETE FROM records WHERE id = ? AND owner_id = ? AND entity = ?")
      .run(Number(id), user.id, entity);
    if (!result.changes) return sendJson(response, 404, { error: "Record not found." });
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 405, { error: "Method not allowed." });
}

async function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      response.writeHead(404);
      return response.end("Not found");
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response, url);
    } else {
      sendJson(response, 405, { error: "Method not allowed." });
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, error.status || 500, { error: error.status ? error.message : "An unexpected server error occurred." });
    } else {
      response.destroy(error);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Northstar CRM is running at http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

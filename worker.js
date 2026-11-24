const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const MAX_PROOF_BYTES = 3 * 1024 * 1024;
const MAX_BANNER_BYTES = 5 * 1024 * 1024;
// Cloudflare Workers WebCrypto supports at most 100,000 PBKDF2 iterations.
const PBKDF2_ITERATIONS = 100000;
const NETWORKS = ["TRC20", "BEP20", "ERC20"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let dbReady = null;      // schema is prepared once per isolate, not on every request
let allowedOrigin = "";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    allowedOrigin = env.APP_ORIGIN || "";
    try {
      if (!dbReady) dbReady = initDb(env.DB, env.PRIMARY_ADMIN_EMAIL || "").catch((e) => { dbReady = null; throw e; });
      await dbReady;
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

      const path = url.pathname, method = request.method;
      if (path === "/api/auth" && method === "POST") return await authRoute(request, env);
      if (path === "/api/public-settings" && method === "GET") return out({ ok: true, settings: await getSettings(env.DB) });
      if (path === "/api/plans" && method === "GET") return out({ ok: true, plans: await getPlans(env.DB) });
      if (path.startsWith("/media/") && method === "GET") return await getPublicMedia(url, env);
      if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

      if (path === "/api/logout" && method === "POST") {
        const token = bearer(request);
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
        return out({ ok: true, message: "Signed out." });
      }

      const session = await requireSession(request, env.DB);
      if (session.error) return out({ ok: false, message: session.error }, 401);
      const user = session.user;

      if (method === "GET" && path === "/api/user") return await userData(user, env);
      if (method === "POST" && path === "/api/deposit") return await createDepositRequest(request, user, env);
      if (method === "POST" && path === "/api/buy-vip") return await buyPlan(await readJson(request), user, env);
      if (method === "POST" && path === "/api/checkin") return await checkin(user, env);
      if (method === "POST" && path === "/api/payment-method") return await savePaymentMethod(await readJson(request), user, env);
      if (method === "POST" && path === "/api/security-pin") return await savePin(await readJson(request), user, env);
      if (method === "POST" && path === "/api/withdraw") return await requestWithdrawal(await readJson(request), user, env);

      if (path.startsWith("/api/admin/")) {
        if (!user.is_super_admin) return out({ ok: false, message: "Super Admin access required." }, 403);
        if (method === "GET" && path === "/api/admin/overview") return await adminOverview(env);
        if (method === "GET" && path === "/api/admin/users") return await adminUsers(url, env);
        if (method === "POST" && path === "/api/admin/settings") return await saveAdminSettings(await readJson(request), env);
        if (method === "POST" && path === "/api/admin/upsert-plan") return await upsertPlan(await readJson(request), env);
        if (method === "POST" && path === "/api/admin/delete-plan") return await deletePlan(await readJson(request), env);
        if (method === "POST" && path === "/api/admin/add-super-admin") return await addSuperAdmin(await readJson(request), user.email, env);
        if (method === "POST" && path === "/api/admin/remove-super-admin") return await removeSuperAdmin(await readJson(request), user.email, env);
        if (method === "POST" && path === "/api/admin/deposit-action") return await decideDeposit(await readJson(request), user.email, env);
        if (method === "POST" && path === "/api/admin/withdrawal-action") return await decideWithdrawal(await readJson(request), user.email, env);
        if (method === "POST" && path === "/api/admin/user-action") return await userAction(await readJson(request), user.email, env);
        if (method === "POST" && path === "/api/admin/banner") return await uploadBanner(request, env);
        if (method === "GET" && path.startsWith("/api/admin/deposit-proof/")) return await getDepositProof(url, env);
      }
      return out({ ok: false, message: "API route not found." }, 404);
    } catch (error) {
      console.error("Request failed", error?.stack || error);
      return out({ ok: false, message: "A server error occurred. Please try again." }, 500);
    }
  }
};

/* ---------- helpers ---------- */
function corsHeaders() {
  return allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } : {};
}
function out(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...corsHeaders() } }); }
async function readJson(request) { try { const v = await request.json(); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
function bearer(request) { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim(); }
const toHex = (bytes) => [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256(value) { return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function pbkdf2Hex(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${await pbkdf2Hex(password, salt, PBKDF2_ITERATIONS)}`;
}
async function verifyPassword(password, stored) {
  stored = String(stored || "");
  if (stored.startsWith("pbkdf2$")) {
    try {
      const [, iter, saltHex, hashHex] = stored.split("$");
      const salt = new Uint8Array(saltHex.match(/.{2}/g).map((x) => parseInt(x, 16)));
      return timingSafeEqual(await pbkdf2Hex(password, salt, Number(iter)), hashHex);
    } catch { return false; }
  }
  return timingSafeEqual(stored, await sha256(`${password}::pdf_usdt_salt`));
}
function money(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function cleanEmail(v) { return String(v || "").trim().toLowerCase(); }
function validWallet(network, address) {
  if (network === "TRC20") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (network === "BEP20" || network === "ERC20") return /^0x[a-fA-F0-9]{40}$/.test(address);
  return false;
}
function sniffImage(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}

/* ---------- rate limiting (stored in D1) ---------- */
async function hits(db, key) {
  const r = await db.prepare("SELECT count FROM rate_limits WHERE key=? AND reset_at>?").bind(key, Date.now()).first();
  return r ? Number(r.count) : 0;
}
async function hit(db, key, windowMs) {
  const now = Date.now();
  await db.prepare(`INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END`).bind(key, now + windowMs, now, now, now + windowMs).run();
  return hits(db, key);
}
async function clearHits(db, key) { await db.prepare("DELETE FROM rate_limits WHERE key=?").bind(key).run(); }

/* ---------- database setup (runs once per isolate) ---------- */
async function initDb(db, primaryAdmin) {
  const now = Date.now();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, custom_id TEXT UNIQUE NOT NULL, fullname TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, referral_code TEXT, password_hash TEXT NOT NULL, balance_usdt REAL NOT NULL DEFAULT 0, vip_level INTEGER NOT NULL DEFAULT 0, vip_expires_at INTEGER DEFAULT 0, wallet_address TEXT DEFAULT '', wallet_network TEXT DEFAULT 'TRC20', withdraw_pin TEXT DEFAULT '', last_checkin_ms INTEGER DEFAULT 0, checkin_count INTEGER DEFAULT 0, is_banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, type TEXT NOT NULL, amount_usdt REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Pending', details TEXT DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_plans (vip_level INTEGER PRIMARY KEY, title TEXT NOT NULL, price_usdt REAL NOT NULL, daily_usdt REAL NOT NULL DEFAULT 0, duration_days INTEGER NOT NULL DEFAULT 30, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS super_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'SUPER_ADMIN', added_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS deposit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, amount_usdt REAL NOT NULL, network TEXT NOT NULL, tx_reference TEXT DEFAULT '', proof_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', admin_note TEXT DEFAULT '', credited_at TEXT DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL)`),
    // A rejected deposit must not block the member from re-submitting the same hash.
    db.prepare(`DROP INDEX IF EXISTS deposit_tx_reference_unique`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS deposit_tx_ref_active ON deposit_requests(tx_reference) WHERE tx_reference <> '' AND status <> 'Rejected'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_email, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_ref ON users(referral_code)`),
    db.prepare(`INSERT OR IGNORE INTO vip_plans (vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES (1,'VIP 1',10,0,30,?)`).bind(now),
    db.prepare(`INSERT OR IGNORE INTO vip_plans (vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES (2,'VIP 2',25,0,30,?)`).bind(now),
    db.prepare(`INSERT OR IGNORE INTO vip_plans (vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES (3,'VIP 3',60,0,30,?)`).bind(now)
  ]);
  // Older databases do not have the is_banned column yet; the error for "duplicate column" is expected and ignored.
  try { await db.prepare("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0").run(); } catch { /* already exists */ }
  if (primaryAdmin) await db.prepare("INSERT OR IGNORE INTO super_admins (email,role,added_by,created_at) VALUES (?,'SUPER_ADMIN','SYSTEM',?)").bind(cleanEmail(primaryAdmin), now).run();
  const defaults = {
    company_name: "Prime Digital Finance", brand_short: "PDF", tagline: "Digital Finance • Transparency • Control",
    hero_title: "Welcome to Prime Digital Finance", hero_subtitle: "Explore your account dashboard and platform services.",
    banner_key: "", deposit_address: "", deposit_network: "TRC20", deposit_instructions: "Send only the selected USDT network. Confirm the address carefully before sending.",
    deposit_min: "1", deposit_max: "5000", withdraw_min: "2", checkin_reward: "0.20", telegram_url: "", whatsapp_url: "", live_chat_url: "", announcement: "Welcome to Prime Digital Finance.",
    faq_text: "Contact support if you need help with a payment or account.",
    registration_open: "1", checkin_requires_vip: "1"
  };
  await db.batch(Object.entries(defaults).map(([k, v]) => db.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value,updated_at) VALUES (?,?,?)").bind(k, v, now)));
}

/* ---------- sessions & auth ---------- */
async function isAdmin(email, db) { return Boolean(await db.prepare("SELECT id FROM super_admins WHERE email=?").bind(cleanEmail(email)).first()); }

async function requireSession(request, db) {
  const token = bearer(request);
  if (!token) return { error: "Please sign in again." };
  const row = await db.prepare(`SELECT u.custom_id, u.fullname, u.email, u.phone, u.referral_code, u.balance_usdt, u.vip_level, u.vip_expires_at, u.wallet_address, u.wallet_network, u.last_checkin_ms, u.checkin_count, u.created_at, u.is_banned, CASE WHEN u.withdraw_pin <> '' THEN 1 ELSE 0 END AS has_pin FROM sessions s JOIN users u ON u.email=s.user_email WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), Date.now()).first();
  if (!row) return { error: "Your session has expired. Please sign in again." };
  if (row.is_banned) return { error: "This account has been suspended. Contact support." };
  row.has_pin = Boolean(row.has_pin);
  row.is_super_admin = await isAdmin(row.email, db);
  // An expired plan no longer counts as active.
  const active = Number(row.vip_level) > 0 && Number(row.vip_expires_at) > Date.now();
  row.vip_level = active ? Number(row.vip_level) : 0;
  if (!active) row.vip_expires_at = 0;
  delete row.is_banned;
  return { user: row };
}

async function authRoute(request, env) {
  const db = env.DB;
  const body = await readJson(request);
  const email = cleanEmail(body.email); const password = String(body.password || "");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!EMAIL_RE.test(email) || password.length < 8 || password.length > 200) return out({ ok: false, message: "Enter a valid email and a password of at least 8 characters." }, 400);

  if (body.mode === "register") {
    if ((await hit(db, `reg:${ip}`, HOUR_MS)) > 10) return out({ ok: false, message: "Too many sign-up attempts. Try again later." }, 429);
    const cfg = await getSettings(db);
    if (cfg.registration_open === "0") return out({ ok: false, message: "New registrations are currently closed." }, 403);
    const name = String(body.fullname || "").trim().slice(0, 100);
    if (!name) return out({ ok: false, message: "Full name is required." }, 400);
    // The owner e-mail is reserved: nobody can claim admin rights just by registering it first.
    const reserved = email === cleanEmail(env.PRIMARY_ADMIN_EMAIL) || await isAdmin(email, db);
    if (reserved && (!env.ADMIN_SETUP_KEY || !timingSafeEqual(String(body.setup_key || ""), String(env.ADMIN_SETUP_KEY)))) {
      return out({ ok: false, message: "This e-mail is reserved for an administrator. Enter the admin setup key." }, 403);
    }
    if (await db.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) return out({ ok: false, message: "An account with this email already exists." }, 409);
    const ref = String(body.referral || "").trim().toUpperCase().slice(0, 20);
    if (ref && !(await db.prepare("SELECT id FROM users WHERE custom_id=?").bind(ref).first())) return out({ ok: false, message: "Referral code not found." }, 400);
    let customId;
    do { customId = "PDF" + String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
    while (await db.prepare("SELECT id FROM users WHERE custom_id=?").bind(customId).first());
    try {
      await db.prepare(`INSERT INTO users (custom_id,fullname,email,phone,referral_code,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`).bind(customId, name, email, String(body.phone || "").slice(0, 30), ref, await hashPassword(password), Date.now()).run();
    } catch { return out({ ok: false, message: "An account with this email already exists." }, 409); }
    return out({ ok: true, message: "Account created. Please sign in." });
  }

  const emailKey = `login:${email}`, ipKey = `login-ip:${ip}`;
  if ((await hits(db, emailKey)) >= 8 || (await hits(db, ipKey)) >= 40) return out({ ok: false, message: "Too many failed attempts. Try again in 15 minutes." }, 429);
  const row = await db.prepare("SELECT password_hash, is_banned FROM users WHERE email=?").bind(email).first();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await hit(db, emailKey, 15 * MIN_MS); await hit(db, ipKey, 15 * MIN_MS);
    return out({ ok: false, message: "Invalid email or password." }, 401);
  }
  if (row.is_banned) return out({ ok: false, message: "This account has been suspended. Contact support." }, 403);
  await clearHits(db, emailKey);
  if (!String(row.password_hash).startsWith(`pbkdf2$${PBKDF2_ITERATIONS}$`)) await db.prepare("UPDATE users SET password_hash=? WHERE email=?").bind(await hashPassword(password), email).run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_email=? AND expires_at<=?").bind(email, now),
    db.prepare("INSERT INTO sessions (token_hash,user_email,expires_at,created_at) VALUES (?,?,?,?)").bind(await sha256(token), email, now + SESSION_TTL_MS, now)
  ]);
  return out({ ok: true, message: "Welcome back.", token });
}

/* ---------- public data ---------- */
async function getPlans(db) { const r = await db.prepare("SELECT vip_level,title,price_usdt,duration_days FROM vip_plans ORDER BY vip_level").all(); return r.results || []; }
async function getSettings(db) { const r = await db.prepare("SELECT setting_key,setting_value FROM site_settings").all(); return Object.fromEntries((r.results || []).map((x) => [x.setting_key, x.setting_value])); }

async function userData(user, env) {
  const [tx, team, total] = await Promise.all([
    env.DB.prepare("SELECT id,type,amount_usdt,status,details,created_at FROM transactions WHERE user_email=? ORDER BY id DESC LIMIT 100").bind(user.email).all(),
    env.DB.prepare("SELECT custom_id,fullname,created_at,vip_level,vip_expires_at FROM users WHERE referral_code=? ORDER BY id DESC LIMIT 100").bind(user.custom_id).all(),
    env.DB.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN vip_level>0 AND vip_expires_at>? THEN 1 ELSE 0 END) AS a FROM users WHERE referral_code=?").bind(Date.now(), user.custom_id).first()
  ]);
  const members = (team.results || []).map((m) => ({ custom_id: m.custom_id, fullname: m.fullname, created_at: m.created_at }));
  return out({ ok: true, user, plans: await getPlans(env.DB), transactions: tx.results || [], settings: await getSettings(env.DB), team: { members, total: Number(total?.c || 0), active: Number(total?.a || 0) } });
}

/* ---------- deposits ---------- */
async function createDepositRequest(request, user, env) {
  if (!env.UPLOADS) return out({ ok: false, message: "File storage is not configured. Admin must finish the R2 setup." }, 503);
  let form; try { form = await request.formData(); } catch { return out({ ok: false, message: "Invalid form data." }, 400); }
  const amount = money(form.get("amount")); const network = String(form.get("network") || "").trim();
  const txRef = String(form.get("tx_reference") || "").trim(); const file = form.get("proof"); const cfg = await getSettings(env.DB);
  if (txRef.length > 128) return out({ ok: false, message: "Transaction reference is too long." }, 400);
  if (!Number.isFinite(amount) || amount <= 0 || amount < Number(cfg.deposit_min || 1) || amount > Number(cfg.deposit_max || 5000)) return out({ ok: false, message: `Deposit must be between ${cfg.deposit_min} and ${cfg.deposit_max} USDT.` }, 400);
  if (network !== String(cfg.deposit_network || "TRC20")) return out({ ok: false, message: "The selected deposit network does not match the administrator's configured network." }, 400);
  if (!cfg.deposit_address) return out({ ok: false, message: "Deposit instructions are not available yet. Please contact support." }, 400);
  if (!file || typeof file.arrayBuffer !== "function" || file.size > MAX_PROOF_BYTES) return out({ ok: false, message: "Upload a JPG, PNG or WEBP payment screenshot up to 3 MB." }, 400);
  const buf = await file.arrayBuffer();
  const img = sniffImage(buf);
  if (!img) return out({ ok: false, message: "Upload a JPG, PNG or WEBP payment screenshot up to 3 MB." }, 400);
  const pending = await env.DB.prepare("SELECT COUNT(*) AS c FROM deposit_requests WHERE user_email=? AND status='Pending'").bind(user.email).first();
  if (Number(pending?.c || 0) >= 5) return out({ ok: false, message: "You already have 5 deposit requests awaiting review. Please wait for the admin." }, 429);
  if (txRef && await env.DB.prepare("SELECT id FROM deposit_requests WHERE tx_reference=? AND status<>'Rejected'").bind(txRef).first()) return out({ ok: false, message: "This transaction reference has already been submitted." }, 409);
  const key = `deposit-proofs/${user.custom_id}/${Date.now()}-${crypto.randomUUID()}.${img.ext}`;
  await env.UPLOADS.put(key, buf, { httpMetadata: { contentType: img.type }, customMetadata: { userEmail: user.email } });
  let res;
  try {
    res = await env.DB.prepare(`INSERT INTO deposit_requests (user_email,amount_usdt,network,tx_reference,proof_key,status,created_at) VALUES (?,?,?,?,?,'Pending',?)`).bind(user.email, amount, network, txRef, key, Date.now()).run();
  } catch {
    await env.UPLOADS.delete(key);
    return out({ ok: false, message: "This transaction reference has already been submitted." }, 409);
  }
  await env.DB.prepare(`INSERT INTO transactions (user_email,type,amount_usdt,status,details,created_at) VALUES (?,'USDT Deposit',?,'Pending',?,?)`).bind(user.email, amount, `Awaiting admin review • ${network} • Deposit request #${res.meta.last_row_id}`, Date.now()).run();
  return out({ ok: true, message: "Deposit request submitted. Your balance will update only after admin approval." });
}

async function decideDeposit(body, adminEmail, env) {
  const id = Number(body.requestId); const decision = body.decision === "Approved" ? "Approved" : body.decision === "Rejected" ? "Rejected" : ""; const note = String(body.note || "").slice(0, 500);
  if (!id || !decision) return out({ ok: false, message: "Invalid deposit decision." }, 400);
  const dep = await env.DB.prepare("SELECT * FROM deposit_requests WHERE id=?").bind(id).first();
  if (!dep) return out({ ok: false, message: "Deposit request not found." }, 404);
  if (dep.status !== "Pending") return out({ ok: false, message: "This request has already been reviewed." }, 409);
  const token = crypto.randomUUID(); const now = Date.now();
  if (decision === "Approved") {
    await env.DB.batch([
      env.DB.prepare("UPDATE deposit_requests SET status='Approved',admin_note=?,credited_at=?,reviewed_at=? WHERE id=? AND status='Pending'").bind(note, token, now, id),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt + ?,2) WHERE email=? AND EXISTS (SELECT 1 FROM deposit_requests WHERE id=? AND status='Approved' AND credited_at=?)").bind(dep.amount_usdt, dep.user_email, id, token),
      env.DB.prepare("UPDATE transactions SET status='Approved',details=details || ? WHERE user_email=? AND type='USDT Deposit' AND status='Pending' AND details LIKE ?").bind(` • Approved by ${adminEmail}`, dep.user_email, `%Deposit request #${id}`)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE deposit_requests SET status='Rejected',admin_note=?,reviewed_at=? WHERE id=? AND status='Pending'").bind(note, now, id),
      env.DB.prepare("UPDATE transactions SET status='Rejected',details=details || ? WHERE user_email=? AND type='USDT Deposit' AND status='Pending' AND details LIKE ?").bind(` • Rejected: ${note || "Not approved"}`, dep.user_email, `%Deposit request #${id}`)
    ]);
  }
  return out({ ok: true, message: decision === "Approved" ? "Deposit approved and member balance credited." : "Deposit rejected. No balance was credited." });
}

async function getDepositProof(url, env) {
  const id = Number(url.pathname.split("/").pop());
  const dep = await env.DB.prepare("SELECT proof_key FROM deposit_requests WHERE id=?").bind(id).first();
  if (!dep) return new Response("Not found", { status: 404 });
  const obj = await env.UPLOADS.get(dep.proof_key); if (!obj) return new Response("File not found", { status: 404 });
  const h = new Headers(); obj.writeHttpMetadata(h); h.set("Cache-Control", "private, no-store"); h.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers: h });
}

/* ---------- media ---------- */
async function uploadBanner(request, env) {
  if (!env.UPLOADS) return out({ ok: false, message: "R2 file storage is not configured." }, 503);
  let form; try { form = await request.formData(); } catch { return out({ ok: false, message: "Invalid form data." }, 400); }
  const file = form.get("banner");
  if (!file || typeof file.arrayBuffer !== "function" || file.size > MAX_BANNER_BYTES) return out({ ok: false, message: "Upload a JPG, PNG or WEBP banner up to 5 MB." }, 400);
  const buf = await file.arrayBuffer(); const img = sniffImage(buf);
  if (!img) return out({ ok: false, message: "Upload a JPG, PNG or WEBP banner up to 5 MB." }, 400);
  const old = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='banner_key'").first();
  const key = `banners/${Date.now()}-${crypto.randomUUID()}.${img.ext}`;
  await env.UPLOADS.put(key, buf, { httpMetadata: { contentType: img.type } });
  await env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES('banner_key',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at").bind(key, Date.now()).run();
  if (old?.setting_value && String(old.setting_value).startsWith("banners/")) { try { await env.UPLOADS.delete(old.setting_value); } catch { /* ignore */ } }
  return out({ ok: true, message: "Home banner updated." });
}

async function getPublicMedia(url, env) {
  let key; try { key = decodeURIComponent(url.pathname.slice("/media/".length)); } catch { return new Response("Not found", { status: 404 }); }
  if (!key.startsWith("banners/") || key.includes("..")) return new Response("Not found", { status: 404 });
  const obj = await env.UPLOADS?.get(key); if (!obj) return new Response("Not found", { status: 404 });
  const h = new Headers(); obj.writeHttpMetadata(h); h.set("Cache-Control", "public, max-age=300"); h.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers: h });
}

/* ---------- admin ---------- */
async function adminOverview(env) {
  const [plans, admins, deposits, withdrawals, users, settings] = await Promise.all([
    env.DB.prepare("SELECT vip_level,title,price_usdt,duration_days FROM vip_plans ORDER BY vip_level").all().then((r) => r.results || []),
    env.DB.prepare("SELECT email,role,added_by,created_at FROM super_admins ORDER BY id").all(),
    env.DB.prepare("SELECT id,user_email,amount_usdt,network,tx_reference,status,admin_note,created_at FROM deposit_requests WHERE status='Pending' ORDER BY id DESC LIMIT 100").all(),
    env.DB.prepare("SELECT id,user_email,amount_usdt,status,details,created_at FROM transactions WHERE type='USDT Withdrawal' AND status='Pending' ORDER BY id DESC LIMIT 100").all(),
    env.DB.prepare("SELECT custom_id,fullname,email,balance_usdt,vip_level,vip_expires_at,is_banned,created_at FROM users ORDER BY id DESC LIMIT 50").all(),
    getSettings(env.DB)
  ]);
  return out({ ok: true, plans, super_admins: admins.results || [], pending_deposits: deposits.results || [], pending_withdrawals: withdrawals.results || [], recent_users: users.results || [], settings });
}

async function adminUsers(url, env) {
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, "");
  const like = `%${q}%`;
  const r = await env.DB.prepare("SELECT custom_id,fullname,email,balance_usdt,vip_level,vip_expires_at,is_banned,created_at FROM users WHERE email LIKE ? OR custom_id LIKE ? OR fullname LIKE ? ORDER BY id DESC LIMIT 50").bind(like, like, like).all();
  return out({ ok: true, users: r.results || [] });
}

async function userAction(b, adminEmail, env) {
  const email = cleanEmail(b.email); const action = String(b.action || "");
  if (!["ban", "unban", "reset-pin"].includes(action)) return out({ ok: false, message: "Invalid action." }, 400);
  const target = await env.DB.prepare("SELECT email FROM users WHERE email=?").bind(email).first();
  if (!target) return out({ ok: false, message: "Member not found." }, 404);
  if (action === "ban") {
    if (email === cleanEmail(adminEmail) || await isAdmin(email, env.DB)) return out({ ok: false, message: "An administrator account cannot be suspended here." }, 400);
    await env.DB.batch([env.DB.prepare("UPDATE users SET is_banned=1 WHERE email=?").bind(email), env.DB.prepare("DELETE FROM sessions WHERE user_email=?").bind(email)]);
    return out({ ok: true, message: "Member suspended and signed out." });
  }
  if (action === "unban") { await env.DB.prepare("UPDATE users SET is_banned=0 WHERE email=?").bind(email).run(); return out({ ok: true, message: "Member re-activated." }); }
  await env.DB.batch([env.DB.prepare("UPDATE users SET withdraw_pin='' WHERE email=?").bind(email), env.DB.prepare("DELETE FROM rate_limits WHERE key=?").bind(`pin:${email}`)]);
  return out({ ok: true, message: "Transaction PIN cleared. The member must set a new one." });
}

async function saveAdminSettings(body, env) {
  const allowed = ["company_name", "brand_short", "tagline", "hero_title", "hero_subtitle", "deposit_address", "deposit_network", "deposit_instructions", "deposit_min", "deposit_max", "withdraw_min", "checkin_reward", "telegram_url", "whatsapp_url", "live_chat_url", "announcement", "faq_text", "registration_open", "checkin_requires_vip"];
  if (body.deposit_network !== undefined && !NETWORKS.includes(String(body.deposit_network))) return out({ ok: false, message: "Choose TRC20, BEP20 or ERC20." }, 400);
  for (const key of ["deposit_min", "deposit_max", "withdraw_min"]) { if (body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) <= 0)) return out({ ok: false, message: `${key} must be greater than zero.` }, 400); }
  if (body.checkin_reward !== undefined && (!Number.isFinite(Number(body.checkin_reward)) || Number(body.checkin_reward) < 0)) return out({ ok: false, message: "Check-in reward cannot be negative." }, 400);
  for (const key of ["registration_open", "checkin_requires_vip"]) { if (body[key] !== undefined && !["0", "1"].includes(String(body[key]))) return out({ ok: false, message: `${key} must be 0 or 1.` }, 400); }
  const current = await getSettings(env.DB);
  const min = Number(body.deposit_min ?? current.deposit_min ?? 1), max = Number(body.deposit_max ?? current.deposit_max ?? 5000);
  if (min > max) return out({ ok: false, message: "Minimum deposit cannot be higher than maximum deposit." }, 400);
  for (const key of ["telegram_url", "whatsapp_url", "live_chat_url"]) { const value = body[key]; if (value && !/^https:\/\//i.test(String(value).trim())) return out({ ok: false, message: `${key} must start with https://` }, 400); }
  const net = String(body.deposit_network ?? current.deposit_network ?? "TRC20");
  const addr = String(body.deposit_address ?? current.deposit_address ?? "").trim();
  if (addr && !validWallet(net, addr)) return out({ ok: false, message: `The deposit address is not a valid ${net} address. Check it carefully.` }, 400);
  const now = Date.now();
  const stmts = [];
  for (const key of allowed) if (body[key] !== undefined) stmts.push(env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at").bind(key, String(body[key]).trim().slice(0, 3000), now));
  if (stmts.length) await env.DB.batch(stmts);
  return out({ ok: true, message: "Website settings saved." });
}

async function upsertPlan(b, env) {
  const level = Number(b.vip_level), price = money(b.price_usdt), days = Number(b.duration_days), title = String(b.title || `VIP ${level}`).trim().slice(0, 60);
  if (!Number.isInteger(level) || level < 1 || !title || !Number.isFinite(price) || price <= 0 || !Number.isInteger(days) || days < 1 || days > 3650) return out({ ok: false, message: "Enter valid product details." }, 400);
  await env.DB.prepare(`INSERT INTO vip_plans(vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES(?,?,?,0,?,?) ON CONFLICT(vip_level) DO UPDATE SET title=excluded.title,price_usdt=excluded.price_usdt,duration_days=excluded.duration_days,updated_at=excluded.updated_at`).bind(level, title, price, days, Date.now()).run();
  return out({ ok: true, message: "Product saved." });
}
async function deletePlan(b, env) {
  const level = Number(b.vip_level);
  if (!Number.isInteger(level)) return out({ ok: false, message: "Invalid product." }, 400);
  await env.DB.prepare("DELETE FROM vip_plans WHERE vip_level=?").bind(level).run();
  return out({ ok: true, message: "Product removed." });
}
async function addSuperAdmin(b, adminEmail, env) {
  const email = cleanEmail(b.newAdminEmail);
  if (!EMAIL_RE.test(email)) return out({ ok: false, message: "Enter a valid admin email." }, 400);
  await env.DB.prepare("INSERT OR IGNORE INTO super_admins(email,role,added_by,created_at) VALUES(?,'SUPER_ADMIN',?,?)").bind(email, adminEmail, Date.now()).run();
  return out({ ok: true, message: "Admin added." });
}
async function removeSuperAdmin(b, adminEmail, env) {
  const email = cleanEmail(b.email);
  if (!email || email === cleanEmail(env.PRIMARY_ADMIN_EMAIL) || email === cleanEmail(adminEmail)) return out({ ok: false, message: "The primary owner and your current admin account cannot be removed here." }, 400);
  await env.DB.prepare("DELETE FROM super_admins WHERE email=?").bind(email).run();
  return out({ ok: true, message: "Admin access removed." });
}

async function decideWithdrawal(b, adminEmail, env) {
  const id = Number(b.txId), decision = b.decision === "Approved" ? "Approved" : b.decision === "Rejected" ? "Rejected" : "";
  if (!id || !decision) return out({ ok: false, message: "Invalid withdrawal decision." }, 400);
  const tx = await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND type='USDT Withdrawal'").bind(id).first();
  if (!tx || tx.status !== "Pending") return out({ ok: false, message: "Pending withdrawal not found." }, 404);
  if (decision === "Rejected") {
    const refundToken = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE transactions SET status='Rejected',details=details || ? WHERE id=? AND status='Pending'").bind(` • Rejected by ${adminEmail} [${refundToken}]`, id),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt + ?,2) WHERE email=? AND EXISTS(SELECT 1 FROM transactions WHERE id=? AND status='Rejected' AND details LIKE ?)").bind(tx.amount_usdt, tx.user_email, id, `%${refundToken}%`)
    ]);
  } else await env.DB.prepare("UPDATE transactions SET status='Approved',details=details || ? WHERE id=? AND status='Pending'").bind(` • Approved by ${adminEmail}`, id).run();
  return out({ ok: true, message: `Withdrawal ${decision.toLowerCase()}.` });
}

/* ---------- member actions ---------- */
async function savePaymentMethod(b, user, env) {
  const addr = String(b.wallet_address || "").trim(), net = String(b.wallet_network || "").trim();
  if (!NETWORKS.includes(net) || !validWallet(net, addr)) return out({ ok: false, message: `Enter a valid ${net || "USDT"} wallet address for the selected network.` }, 400);
  await env.DB.prepare("UPDATE users SET wallet_address=?,wallet_network=? WHERE email=?").bind(addr, net, user.email).run();
  return out({ ok: true, message: "Withdrawal wallet saved." });
}

async function savePin(b, user, env) {
  const pin = String(b.pin || "");
  if (!/^\d{4}$/.test(pin)) return out({ ok: false, message: "PIN must be exactly 4 digits." }, 400);
  await env.DB.prepare("UPDATE users SET withdraw_pin=? WHERE email=?").bind(await hashPassword(pin), user.email).run();
  return out({ ok: true, message: "Transaction PIN saved securely." });
}

async function requestWithdrawal(b, user, env) {
  const db = env.DB; const amount = money(b.amount), pin = String(b.pin || "");
  if (!Number.isFinite(amount) || amount <= 0) return out({ ok: false, message: "Enter a valid amount." }, 400);
  const pinKey = `pin:${user.email}`;
  if ((await hits(db, pinKey)) >= 5) return out({ ok: false, message: "Too many incorrect PIN attempts. Try again in 30 minutes." }, 429);
  const cfg = await getSettings(db);
  const record = await db.prepare("SELECT wallet_address,wallet_network,withdraw_pin FROM users WHERE email=?").bind(user.email).first();
  if (!record.wallet_address) return out({ ok: false, message: "Save your withdrawal wallet first." }, 400);
  if (!record.withdraw_pin) return out({ ok: false, message: "Set your 4-digit security PIN first." }, 400);
  if (!(await verifyPassword(pin, record.withdraw_pin))) { await hit(db, pinKey, 30 * MIN_MS); return out({ ok: false, message: "Incorrect transaction PIN." }, 403); }
  await clearHits(db, pinKey);
  const min = Number(cfg.withdraw_min || 2);
  if (amount < min) return out({ ok: false, message: `Withdrawal minimum is ${min} USDT.` }, 400);
  // Both statements run in one transaction and share the same balance condition.
  const res = await db.batch([
    db.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,'USDT Withdrawal',?,'Pending',?,? WHERE EXISTS(SELECT 1 FROM users WHERE email=? AND balance_usdt>=?)").bind(user.email, amount, `Reserved for ${record.wallet_network}: ${record.wallet_address}`, Date.now(), user.email, amount),
    db.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt-?,2) WHERE email=? AND balance_usdt>=?").bind(amount, user.email, amount)
  ]);
  if (!res[1].meta?.changes) return out({ ok: false, message: "Insufficient balance." }, 400);
  return out({ ok: true, message: "Withdrawal request submitted for admin review." });
}

async function buyPlan(b, user, env) {
  const p = await env.DB.prepare("SELECT * FROM vip_plans WHERE vip_level=?").bind(Number(b.vip)).first();
  if (!p) return out({ ok: false, message: "Product not found." }, 404);
  const now = Date.now(); const expires = now + Number(p.duration_days) * DAY_MS;
  const cond = "email=? AND is_banned=0 AND balance_usdt>=? AND (vip_level<? OR COALESCE(vip_expires_at,0)<=?)";
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,?,?,'Approved','Product purchase',? WHERE EXISTS(SELECT 1 FROM users WHERE ${cond})`).bind(user.email, `${p.title} Purchase`, p.price_usdt, now, user.email, p.price_usdt, p.vip_level, now),
    env.DB.prepare(`UPDATE users SET balance_usdt=ROUND(balance_usdt-?,2),vip_level=?,vip_expires_at=? WHERE ${cond}`).bind(p.price_usdt, p.vip_level, expires, user.email, p.price_usdt, p.vip_level, now)
  ]);
  if (!res[1].meta?.changes) {
    const u = await env.DB.prepare("SELECT balance_usdt FROM users WHERE email=?").bind(user.email).first();
    return out({ ok: false, message: Number(u?.balance_usdt || 0) < Number(p.price_usdt) ? "Insufficient balance." : "Choose a higher product level." }, 400);
  }
  return out({ ok: true, message: `${p.title} activated.` });
}

async function checkin(user, env) {
  const cfg = await getSettings(env.DB);
  const reward = money(cfg.checkin_reward || 0);
  if (!(reward > 0)) return out({ ok: false, message: "Daily check-in is currently disabled." }, 400);
  if (cfg.checkin_requires_vip !== "0" && Number(user.vip_level) <= 0) return out({ ok: false, message: "Activate a product plan to use the daily check-in." }, 403);
  const now = Date.now(), cutoff = now - DAY_MS;
  const res = await env.DB.batch([
    env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,'Daily Check-in',?,'Approved','Daily check-in credit',? WHERE EXISTS(SELECT 1 FROM users WHERE email=? AND COALESCE(last_checkin_ms,0)<=?)").bind(user.email, reward, now, user.email, cutoff),
    env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt+?,2),last_checkin_ms=?,checkin_count=checkin_count+1 WHERE email=? AND COALESCE(last_checkin_ms,0)<=?").bind(reward, now, user.email, cutoff)
  ]);
  if (!res[1].meta?.changes) return out({ ok: false, message: "Daily check-in is not available yet." }, 400);
  return out({ ok: true, message: "Check-in recorded." });
}

const APP_VERSION = "2.1.0";
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
const BOOL_KEYS = ["earnings_enabled", "referral_enabled", "referral_manual_approval", "referral_on_upgrades", "registration_open", "deposits_enabled", "withdrawals_enabled", "vip_purchases_enabled", "checkin_enabled", "checkin_requires_vip", "maintenance_mode"];
const COMPANY_KEYS = ["company_legal_name", "cac_number", "company_description", "company_address", "company_phone", "company_email", "company_website", "company_mission", "company_vision", "products_services", "how_we_operate", "revenue_model", "earnings_funding", "license_info", "terms_text", "privacy_text"];
const LONG_KEYS = ["terms_text", "privacy_text", "how_we_operate", "revenue_model", "earnings_funding", "products_services", "company_description"];
const SETTING_KEYS = ["company_name", "brand_short", "tagline", "hero_title", "hero_subtitle", "deposit_address", "deposit_network", "deposit_instructions", "deposit_min", "deposit_max", "withdraw_min", "withdraw_max", "withdraw_fee", "checkin_reward", "checkin_interval_hours", "telegram_url", "whatsapp_url", "live_chat_url", "announcement", "faq_text", "maintenance_message", "earnings_method", "earnings_frequency_hours", "referral_percent", ...COMPANY_KEYS, ...BOOL_KEYS];

let dbReady = null;      // schema is prepared once per isolate, not on every request
let allowedOrigin = "";
let settingsCache = { at: 0, value: null };

export default {
  async scheduled(event, env, ctx) {
    if (!dbReady) dbReady = initDb(env.DB, env.PRIMARY_ADMIN_EMAIL || "").catch((e) => { dbReady = null; throw e; });
    await dbReady;
    ctx.waitUntil(processAutoEarnings(env, "SYSTEM"));
  },
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
      if (path === "/api/company" && method === "GET") return await companyPublic(env);
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

      const live = await getSettingsCached(env.DB);
      if (live.maintenance_mode === "1" && !user.is_super_admin) return out({ ok: false, maintenance: true, message: live.maintenance_message || "We are performing maintenance. Please check back soon." }, 503);

      if (method === "GET" && path === "/api/user") return await userData(user, env);
      if (method === "POST" && path === "/api/deposit") return await createDepositRequest(request, user, env);
      if (method === "POST" && path === "/api/buy-vip") return await buyPlan(await readJson(request), user, env);
      if (method === "POST" && path === "/api/checkin") return await checkin(user, env);
      if (method === "POST" && path === "/api/claim-earning") return await claimEarning(user, env);
      if (method === "POST" && path === "/api/payment-method") return await savePaymentMethod(await readJson(request), user, env);
      if (method === "POST" && path === "/api/security-pin") return await savePin(await readJson(request), user, env);
      if (method === "POST" && path === "/api/withdraw") return await requestWithdrawal(await readJson(request), user, env);
      if (method === "GET" && path === "/api/notifications") return await listNotifications(user, env);
      if (method === "POST" && path === "/api/notifications/seen") return await markNotificationsSeen(user, env);
      if (method === "POST" && path === "/api/change-password") return await changePassword(await readJson(request), user, request, env);
      if (method === "POST" && path === "/api/logout-all") return await logoutAll(user, env);

      if (path.startsWith("/api/admin/")) {
        if (!user.is_super_admin) { await logEvent(env.DB, "security", `Blocked admin API access by ${user.email}: ${path}`); return out({ ok: false, message: "Super Admin access required." }, 403); }
        const a = user.email;
        if (method === "GET") {
          if (path === "/api/admin/overview") return await adminOverview(env);
          if (path === "/api/admin/dashboard") return await adminDashboard(url, env);
          if (path === "/api/admin/users") return await adminUsers(url, env);
          if (path === "/api/admin/user-detail") return await adminUserDetail(url, env);
          if (path === "/api/admin/deposits") return await adminDeposits(url, env);
          if (path === "/api/admin/withdrawals") return await adminWithdrawals(url, env);
          if (path === "/api/admin/purchases") return await adminPurchases(url, env);
          if (path === "/api/admin/audit") return await adminAudit(url, env);
          if (path === "/api/admin/health") return await adminHealth(env);
          if (path === "/api/admin/earnings") return await adminEarnings(url, env);
          if (path === "/api/admin/commissions") return await adminCommissions(url, env);
          if (path.startsWith("/api/admin/deposit-proof/")) return await getDepositProof(url, env);
        }
        if (method === "POST") {
          if (path === "/api/admin/banner") return await uploadBanner(request, a, env);
          if (path === "/api/admin/company-file") return await uploadCompanyFile(request, a, env);
          const body = await readJson(request);
          if (path === "/api/admin/settings") return await saveAdminSettings(body, a, env);
          if (path === "/api/admin/upsert-plan") return await upsertPlan(body, a, env);
          if (path === "/api/admin/delete-plan") return await deletePlan(body, a, env);
          if (path === "/api/admin/add-super-admin") return await addSuperAdmin(body, a, env);
          if (path === "/api/admin/remove-super-admin") return await removeSuperAdmin(body, a, env);
          if (path === "/api/admin/deposit-action") return await decideDeposit(body, a, env);
          if (path === "/api/admin/withdrawal-action") return await decideWithdrawal(body, a, env);
          if (path === "/api/admin/user-action") return await userAction(body, a, env);
          if (path === "/api/admin/adjust-balance") return await adjustBalance(body, a, env);
          if (path === "/api/admin/company-doc-delete") return await deleteCompanyDoc(body, a, env);
          if (path === "/api/admin/fund-allocation") return await fundAllocation(body, a, env);
          if (path === "/api/admin/ledger-correction") return await ledgerCorrection(body, a, env);
          if (path === "/api/admin/pause-earning") return await pauseEarning(body, a, env);
          if (path === "/api/admin/commission-action") return await commissionAction(body, a, env);
          if (path === "/api/admin/run-earnings") return out(await processAutoEarnings(env, a));
          if (path === "/api/admin/send-notification") return await sendNotification(body, a, env);
          if (path === "/api/admin/delete-notification") return await deleteNotification(body, a, env);
        }
      }
      return out({ ok: false, message: "API route not found." }, 404);
    } catch (error) {
      console.error("Request failed", error?.stack || error);
      try { await logEvent(env.DB, "error", `${request.method} ${url.pathname}: ${String(error?.message || error).slice(0, 300)}`); } catch { /* ignore */ }
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
function sniffDoc(buf) {
  const img = sniffImage(buf); if (img) return img;
  const b = new Uint8Array(buf.slice(0, 5));
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { type: "application/pdf", ext: "pdf" };
  return null;
}
function range(url) {
  const from = Number(url.searchParams.get("from")) || 0;
  const to = Number(url.searchParams.get("to")) || 9e15;
  return { from, to };
}

/* ---------- rate limiting, audit and event logs (stored in D1) ---------- */
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
async function logEvent(db, level, message) {
  try { await db.prepare("INSERT INTO system_events(level,message,created_at) VALUES(?,?,?)").bind(level, String(message).slice(0, 400), Date.now()).run(); } catch { /* never break the request */ }
}
function auditStmt(db, actor, action, target, details, reason) {
  return db.prepare("INSERT INTO audit_log(actor,action,target,details,reason,created_at) VALUES(?,?,?,?,?,?)").bind(actor, action, target || "", JSON.stringify(details || {}).slice(0, 2000), String(reason || "").slice(0, 500), Date.now());
}
async function audit(db, actor, action, target, details, reason) {
  try { await auditStmt(db, actor, action, target, details, reason).run(); } catch (e) { console.error("audit failed", e); }
}

/* ---------- database setup (runs once per isolate; never deletes data) ---------- */
async function initDb(db, primaryAdmin) {
  const now = Date.now();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, custom_id TEXT UNIQUE NOT NULL, fullname TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, referral_code TEXT, password_hash TEXT NOT NULL, balance_usdt REAL NOT NULL DEFAULT 0, vip_level INTEGER NOT NULL DEFAULT 0, vip_expires_at INTEGER DEFAULT 0, wallet_address TEXT DEFAULT '', wallet_network TEXT DEFAULT 'TRC20', withdraw_pin TEXT DEFAULT '', last_checkin_ms INTEGER DEFAULT 0, checkin_count INTEGER DEFAULT 0, is_banned INTEGER NOT NULL DEFAULT 0, notif_seen_at INTEGER NOT NULL DEFAULT 0, withdraw_frozen INTEGER NOT NULL DEFAULT 0, admin_note TEXT NOT NULL DEFAULT '', last_login_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, type TEXT NOT NULL, amount_usdt REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Pending', details TEXT DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_plans (vip_level INTEGER PRIMARY KEY, title TEXT NOT NULL, price_usdt REAL NOT NULL, daily_usdt REAL NOT NULL DEFAULT 0, duration_days INTEGER NOT NULL DEFAULT 30, description TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, vip_level INTEGER NOT NULL, plan_title TEXT NOT NULL, price_usdt REAL NOT NULL, kind TEXT NOT NULL DEFAULT 'purchase', status TEXT NOT NULL DEFAULT 'active', started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS super_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'SUPER_ADMIN', added_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS deposit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, amount_usdt REAL NOT NULL, network TEXT NOT NULL, tx_reference TEXT DEFAULT '', proof_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', admin_note TEXT DEFAULT '', credited_at TEXT DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT 'SYSTEM', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS system_events (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS company_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, file_key TEXT NOT NULL, content_type TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS funding_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, amount REAL NOT NULL, ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT 'SYSTEM', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ledger_ref_unique ON funding_ledger(ref) WHERE ref <> ''`),
    db.prepare(`CREATE TABLE IF NOT EXISTS referral_commissions (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_email TEXT NOT NULL, referred_email TEXT NOT NULL, purchase_id INTEGER NOT NULL UNIQUE, base_usdt REAL NOT NULL, percent REAL NOT NULL, amount_usdt REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', note TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '', decided_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_comm_referrer ON referral_commissions(referrer_email, id)`),
    // A rejected deposit must not block the member from re-submitting the same hash.
    db.prepare(`DROP INDEX IF EXISTS deposit_tx_reference_unique`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS deposit_tx_ref_active ON deposit_requests(tx_reference) WHERE tx_reference <> '' AND status <> 'Rejected'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_email, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_ref ON users(referral_code)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_email, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_vip_user ON vip_purchases(user_email, id)`)
  ]);
  // Add columns that older databases do not have yet. "duplicate column" errors are expected and ignored.
  for (const ddl of [
    "ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN notif_seen_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN withdraw_frozen INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN last_login_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_plans ADD COLUMN description TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE vip_plans ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE vip_plans ADD COLUMN earn_start_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_plans ADD COLUMN earn_end_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_plans ADD COLUMN earn_total_limit REAL NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN daily_usdt REAL NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN earn_limit REAL NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN earned_total REAL NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN earn_claims INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN last_earn_ms INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN earn_paused INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN earn_start_at INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE vip_purchases ADD COLUMN earn_end_at INTEGER NOT NULL DEFAULT 0"
  ]) { try { await db.prepare(ddl).run(); } catch { /* column already exists */ } }
  // Database-level guarantee: a member can never have two active VIP rows.
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_vip ON vip_purchases(user_email) WHERE status='active'`).run();
  // The audit log is append-only. If the platform refuses triggers, the app still works.
  for (const ddl of [
    `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END`,
    `CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END`
  ]) { try { await db.prepare(ddl).run(); } catch (e) { console.error("trigger not created", e); } }
  // Existing VIP members get a history row so nothing is lost by the new structure.
  await db.prepare(`INSERT INTO vip_purchases(user_email,vip_level,plan_title,price_usdt,kind,status,started_at,expires_at,ended_at)
    SELECT u.email,u.vip_level,COALESCE(p.title,'VIP '||u.vip_level),COALESCE(p.price_usdt,0),'purchase',CASE WHEN COALESCE(u.vip_expires_at,0)>? THEN 'active' ELSE 'expired' END,
    COALESCE(u.vip_expires_at,0)-COALESCE(p.duration_days,30)*86400000,COALESCE(u.vip_expires_at,0),CASE WHEN COALESCE(u.vip_expires_at,0)>? THEN 0 ELSE COALESCE(u.vip_expires_at,0) END
    FROM users u LEFT JOIN vip_plans p ON p.vip_level=u.vip_level
    WHERE u.vip_level>0 AND NOT EXISTS(SELECT 1 FROM vip_purchases v WHERE v.user_email=u.email)`).bind(now, now).run();
  if (primaryAdmin) await db.prepare("INSERT OR IGNORE INTO super_admins (email,role,added_by,created_at) VALUES (?,'SUPER_ADMIN','SYSTEM',?)").bind(cleanEmail(primaryAdmin), now).run();
  const defaults = {
    company_name: "Prime Digital Finance", brand_short: "PDF", tagline: "Digital Finance • Transparency • Control",
    hero_title: "Welcome to Prime Digital Finance", hero_subtitle: "Explore your account dashboard and platform services.",
    banner_key: "", deposit_address: "", deposit_network: "TRC20", deposit_instructions: "Send only the selected USDT network. Confirm the address carefully before sending.",
    deposit_min: "1", deposit_max: "5000", withdraw_min: "2", withdraw_max: "0", withdraw_fee: "0", checkin_reward: "0.20", checkin_interval_hours: "24",
    telegram_url: "", whatsapp_url: "", live_chat_url: "", announcement: "Welcome to Prime Digital Finance.",
    faq_text: "Contact support if you need help with a payment or account.",
    registration_open: "1", deposits_enabled: "1", withdrawals_enabled: "1", vip_purchases_enabled: "1", checkin_enabled: "1", checkin_requires_vip: "1",
    earnings_enabled: "0", earnings_method: "claim", earnings_frequency_hours: "24", referral_enabled: "0", referral_percent: "0", referral_manual_approval: "1", referral_on_upgrades: "0", company_logo_key: "",
    ...Object.fromEntries(COMPANY_KEYS.map((k) => [k, ""])),
    maintenance_mode: "0", maintenance_message: "We are performing maintenance. Please check back soon."
  };
  await db.batch(Object.entries(defaults).map(([k, v]) => db.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value,updated_at) VALUES (?,?,?)").bind(k, v, now)));
}

/* ---------- settings ---------- */
async function getSettings(db) { const r = await db.prepare("SELECT setting_key,setting_value FROM site_settings").all(); return Object.fromEntries((r.results || []).map((x) => [x.setting_key, x.setting_value])); }
async function getSettingsCached(db) {
  if (settingsCache.value && Date.now() - settingsCache.at < 5000) return settingsCache.value;
  settingsCache = { at: Date.now(), value: await getSettings(db) };
  return settingsCache.value;
}
async function getPlans(db) { const r = await db.prepare("SELECT vip_level,title,price_usdt,duration_days,description,daily_usdt,earn_start_at,earn_end_at,earn_total_limit FROM vip_plans WHERE is_active=1 ORDER BY vip_level").all(); return r.results || []; }

/* ---------- sessions & auth ---------- */
async function isAdmin(email, db) { return Boolean(await db.prepare("SELECT id FROM super_admins WHERE email=?").bind(cleanEmail(email)).first()); }

async function requireSession(request, db) {
  const token = bearer(request);
  if (!token) return { error: "Please sign in again." };
  const row = await db.prepare(`SELECT u.custom_id, u.fullname, u.email, u.phone, u.referral_code, u.balance_usdt, u.vip_level, u.vip_expires_at, u.wallet_address, u.wallet_network, u.last_checkin_ms, u.checkin_count, u.created_at, u.is_banned, u.withdraw_frozen, CASE WHEN u.withdraw_pin <> '' THEN 1 ELSE 0 END AS has_pin FROM sessions s JOIN users u ON u.email=s.user_email WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), Date.now()).first();
  if (!row) return { error: "Your session has expired. Please sign in again." };
  if (row.is_banned) return { error: "This account has been suspended. Contact support." };
  row.has_pin = Boolean(row.has_pin);
  row.withdraw_frozen = Boolean(row.withdraw_frozen);
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
    if (cfg.maintenance_mode === "1") return out({ ok: false, message: "The site is under maintenance. Please try again later." }, 503);
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
  if ((await hits(db, emailKey)) >= 8 || (await hits(db, ipKey)) >= 40) { await logEvent(db, "security", `Login lockout for ${email}`); return out({ ok: false, message: "Too many failed attempts. Try again in 15 minutes." }, 429); }
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
    db.prepare("INSERT INTO sessions (token_hash,user_email,expires_at,created_at) VALUES (?,?,?,?)").bind(await sha256(token), email, now + SESSION_TTL_MS, now),
    db.prepare("UPDATE users SET last_login_at=? WHERE email=?").bind(now, email)
  ]);
  return out({ ok: true, message: "Welcome back.", token });
}

async function userData(user, env) {
  const [tx, team, total, unread, pend, vip, comm] = await Promise.all([
    env.DB.prepare("SELECT id,type,amount_usdt,status,details,created_at FROM transactions WHERE user_email=? ORDER BY id DESC LIMIT 200").bind(user.email).all(),
    env.DB.prepare("SELECT u.custom_id,u.fullname,u.created_at,EXISTS(SELECT 1 FROM vip_purchases v WHERE v.user_email=u.email) AS purchased FROM users u WHERE u.referral_code=? ORDER BY u.id DESC LIMIT 100").bind(user.custom_id).all(),
    env.DB.prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN vip_level>0 AND vip_expires_at>? THEN 1 ELSE 0 END) AS a FROM users WHERE referral_code=?").bind(Date.now(), user.custom_id).first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE (user_email=? OR (user_email IS NULL AND created_at>=?)) AND created_at>(SELECT notif_seen_at FROM users WHERE email=?)").bind(user.email, user.created_at, user.email).first(),
    user.is_super_admin ? env.DB.prepare("SELECT (SELECT COUNT(*) FROM deposit_requests WHERE status='Pending') AS d, (SELECT COUNT(*) FROM transactions WHERE type='USDT Withdrawal' AND status='Pending') AS w").first() : Promise.resolve(null),
    env.DB.prepare("SELECT id,vip_level,plan_title,price_usdt,kind,started_at,expires_at,daily_usdt,earn_limit,earned_total,earn_claims,last_earn_ms,earn_paused,earn_start_at,earn_end_at FROM vip_purchases WHERE user_email=? AND status='active' AND expires_at>?").bind(user.email, Date.now()).first(),
    env.DB.prepare("SELECT c.id,c.amount_usdt,c.percent,c.status,c.note,c.created_at,u.fullname AS referred_name FROM referral_commissions c JOIN users u ON u.email=c.referred_email WHERE c.referrer_email=? ORDER BY c.id DESC LIMIT 100").bind(user.email).all()
  ]);
  const members = (team.results || []).map((m) => ({ custom_id: m.custom_id, fullname: m.fullname, created_at: m.created_at, purchased: Boolean(m.purchased) }));
  return out({
    ok: true, user, plans: await getPlans(env.DB), transactions: tx.results || [], settings: await getSettings(env.DB),
    current_vip: vip || null,
    team: { members, total: Number(total?.c || 0), active: Number(total?.a || 0) },
    unread: Number(unread?.c || 0),
    commissions: comm.results || [],
    admin_pending: pend ? { deposits: Number(pend.d), withdrawals: Number(pend.w) } : null
  });
}

/* ---------- deposits ---------- */
async function createDepositRequest(request, user, env) {
  if (!env.UPLOADS) return out({ ok: false, message: "File storage is not configured. Admin must finish the R2 setup." }, 503);
  let form; try { form = await request.formData(); } catch { return out({ ok: false, message: "Invalid form data." }, 400); }
  const amount = money(form.get("amount")); const network = String(form.get("network") || "").trim();
  const txRef = String(form.get("tx_reference") || "").trim(); const file = form.get("proof"); const cfg = await getSettings(env.DB);
  if (cfg.deposits_enabled === "0") return out({ ok: false, message: "Deposits are temporarily unavailable." }, 503);
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
  const log = auditStmt(env.DB, adminEmail, `deposit.${decision.toLowerCase()}`, dep.user_email, { request_id: id, amount: dep.amount_usdt, reference: dep.tx_reference }, note);
  if (decision === "Approved") {
    await env.DB.batch([
      env.DB.prepare("UPDATE deposit_requests SET status='Approved',admin_note=?,credited_at=?,reviewed_at=? WHERE id=? AND status='Pending'").bind(note, token, now, id),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt + ?,2) WHERE email=? AND EXISTS (SELECT 1 FROM deposit_requests WHERE id=? AND status='Approved' AND credited_at=?)").bind(dep.amount_usdt, dep.user_email, id, token),
      env.DB.prepare("UPDATE transactions SET status='Approved',details=details || ? WHERE user_email=? AND type='USDT Deposit' AND status='Pending' AND details LIKE ?").bind(` • Approved by ${adminEmail}`, dep.user_email, `%Deposit request #${id}`),
      log
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE deposit_requests SET status='Rejected',admin_note=?,reviewed_at=? WHERE id=? AND status='Pending'").bind(note, now, id),
      env.DB.prepare("UPDATE transactions SET status='Rejected',details=details || ? WHERE user_email=? AND type='USDT Deposit' AND status='Pending' AND details LIKE ?").bind(` • Rejected: ${note || "Not approved"}`, dep.user_email, `%Deposit request #${id}`),
      log
    ]);
  }
  await notify(env.DB, dep.user_email, decision === "Approved" ? "Deposit approved" : "Deposit not approved",
    decision === "Approved" ? `Your deposit of ${Number(dep.amount_usdt).toFixed(2)} USDT has been credited to your balance.` : `Your deposit of ${Number(dep.amount_usdt).toFixed(2)} USDT was not approved.${note ? " Reason: " + note : ""}`);
  return out({ ok: true, message: decision === "Approved" ? "Deposit approved and member balance credited." : "Deposit rejected. No balance was credited." });
}

async function getDepositProof(url, env) {
  const id = Number(url.pathname.split("/").pop());
  const dep = await env.DB.prepare("SELECT proof_key FROM deposit_requests WHERE id=?").bind(id).first();
  if (!dep || !env.UPLOADS) return new Response("Not found", { status: 404 });
  const obj = await env.UPLOADS.get(dep.proof_key); if (!obj) return new Response("File not found", { status: 404 });
  const h = new Headers(); obj.writeHttpMetadata(h); h.set("Cache-Control", "private, no-store"); h.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers: h });
}

/* ---------- media ---------- */
async function uploadBanner(request, adminEmail, env) {
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
  await audit(env.DB, adminEmail, "settings.banner", "banner_key", { previous: old?.setting_value || "", next: key }, "");
  return out({ ok: true, message: "Home banner updated." });
}

async function getPublicMedia(url, env) {
  let key; try { key = decodeURIComponent(url.pathname.slice("/media/".length)); } catch { return new Response("Not found", { status: 404 }); }
  if (!(key.startsWith("banners/") || key.startsWith("company/")) || key.includes("..")) return new Response("Not found", { status: 404 });
  const obj = await env.UPLOADS?.get(key); if (!obj) return new Response("Not found", { status: 404 });
  const h = new Headers(); obj.writeHttpMetadata(h); h.set("Cache-Control", "public, max-age=300"); h.set("X-Content-Type-Options", "nosniff");
  return new Response(obj.body, { headers: h });
}

/* ---------- admin: read APIs ---------- */
async function adminOverview(env) {
  const [plans, admins, settings, notes, pend] = await Promise.all([
    env.DB.prepare("SELECT vip_level,title,price_usdt,duration_days,description,is_active,daily_usdt,earn_start_at,earn_end_at,earn_total_limit FROM vip_plans ORDER BY vip_level").all().then((r) => r.results || []),
    env.DB.prepare("SELECT email,role,added_by,created_at FROM super_admins ORDER BY id").all(),
    getSettings(env.DB),
    env.DB.prepare("SELECT id,user_email,title,body,created_at FROM notifications WHERE created_by<>'SYSTEM' ORDER BY id DESC LIMIT 20").all(),
    env.DB.prepare("SELECT (SELECT COUNT(*) FROM deposit_requests WHERE status='Pending') AS d, (SELECT COUNT(*) FROM transactions WHERE type='USDT Withdrawal' AND status='Pending') AS w").first()
  ]);
  return out({ ok: true, plans, super_admins: admins.results || [], settings, notifications: notes.results || [], pending: { deposits: Number(pend.d), withdrawals: Number(pend.w) } });
}

async function adminDashboard(url, env) {
  const { from, to } = range(url); const now = Date.now(); const db = env.DB;
  const [users, bal, dep, wd, vipActive, vipEver, purch, refs, chk, recent, events] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN is_banned=0 THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN is_banned=1 THEN 1 ELSE 0 END) AS suspended FROM users").first(),
    db.prepare("SELECT COALESCE(SUM(balance_usdt),0) AS s FROM users").first(),
    db.prepare("SELECT status, COUNT(*) AS c, COALESCE(SUM(amount_usdt),0) AS s FROM deposit_requests WHERE created_at BETWEEN ? AND ? GROUP BY status").bind(from, to).all(),
    db.prepare("SELECT status, COUNT(*) AS c, COALESCE(SUM(amount_usdt),0) AS s FROM transactions WHERE type='USDT Withdrawal' AND created_at BETWEEN ? AND ? GROUP BY status").bind(from, to).all(),
    db.prepare("SELECT COUNT(*) AS c FROM vip_purchases WHERE status='active' AND expires_at>?").bind(now).first(),
    db.prepare("SELECT COUNT(DISTINCT user_email) AS c FROM vip_purchases").first(),
    db.prepare("SELECT kind, COUNT(*) AS c, COALESCE(SUM(price_usdt),0) AS s FROM vip_purchases WHERE started_at BETWEEN ? AND ? GROUP BY kind").bind(from, to).all(),
    db.prepare("SELECT COUNT(*) AS c FROM users WHERE referral_code<>''").first(),
    db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(amount_usdt),0) AS s FROM transactions WHERE type='Daily Check-in' AND created_at BETWEEN ? AND ?").bind(from, to).first(),
    db.prepare("SELECT id,user_email,type,amount_usdt,status,details,created_at FROM transactions WHERE type<>'Account Activity' ORDER BY id DESC LIMIT 15").all(),
    db.prepare("SELECT id,level,message,created_at FROM system_events ORDER BY id DESC LIMIT 5").all()
  ]);
  const by = (rows) => Object.fromEntries((rows.results || []).map((r) => [r.status || r.kind, { count: Number(r.c), total: money(r.s) }]));
  const p = by(purch);
  const activeVip = Number(vipActive?.c || 0);
  return out({
    ok: true,
    users: { total: Number(users.total), active: Number(users.active || 0), suspended: Number(users.suspended || 0) },
    balances_total: money(bal.s),
    deposits: by(dep), withdrawals: by(wd),
    vip: { active: activeVip, expired: Math.max(0, Number(vipEver?.c || 0) - activeVip), purchases: p.purchase || { count: 0, total: 0 }, upgrades: p.upgrade || { count: 0, total: 0 } },
    direct_referrals: Number(refs?.c || 0),
    checkins: { count: Number(chk?.c || 0), total: money(chk?.s || 0) },
    recent_transactions: recent.results || [],
    alerts: events.results || []
  });
}

async function adminUsers(url, env) {
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, "");
  const like = `%${q}%`;
  const r = await env.DB.prepare("SELECT custom_id,fullname,email,phone,balance_usdt,vip_level,vip_expires_at,is_banned,withdraw_frozen,created_at FROM users WHERE email LIKE ? OR custom_id LIKE ? OR fullname LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 50").bind(like, like, like, like).all();
  return out({ ok: true, users: r.results || [] });
}

async function adminUserDetail(url, env) {
  const email = cleanEmail(url.searchParams.get("email"));
  // Password hashes, PINs and session tokens are never selected.
  const u = await env.DB.prepare("SELECT custom_id,fullname,email,phone,referral_code,balance_usdt,vip_level,vip_expires_at,wallet_address,wallet_network,is_banned,withdraw_frozen,admin_note,last_login_at,checkin_count,created_at FROM users WHERE email=?").bind(email).first();
  if (!u) return out({ ok: false, message: "Member not found." }, 404);
  const [tx, dep, vip, invited, referrer] = await Promise.all([
    env.DB.prepare("SELECT id,type,amount_usdt,status,details,created_at FROM transactions WHERE user_email=? ORDER BY id DESC LIMIT 100").bind(email).all(),
    env.DB.prepare("SELECT id,amount_usdt,network,tx_reference,status,admin_note,created_at FROM deposit_requests WHERE user_email=? ORDER BY id DESC LIMIT 50").bind(email).all(),
    env.DB.prepare("SELECT id,vip_level,plan_title,price_usdt,kind,status,started_at,expires_at FROM vip_purchases WHERE user_email=? ORDER BY id DESC LIMIT 50").bind(email).all(),
    env.DB.prepare("SELECT x.custom_id,x.fullname,x.created_at,EXISTS(SELECT 1 FROM vip_purchases v WHERE v.user_email=x.email) AS purchased FROM users x WHERE x.referral_code=? ORDER BY x.id DESC LIMIT 100").bind(u.custom_id).all(),
    u.referral_code ? env.DB.prepare("SELECT custom_id,fullname FROM users WHERE custom_id=?").bind(u.referral_code).first() : Promise.resolve(null)
  ]);
  return out({ ok: true, user: u, transactions: tx.results || [], deposits: dep.results || [], vip_history: vip.results || [], invited: (invited.results || []).map((m) => ({ ...m, purchased: Boolean(m.purchased) })), referrer: referrer || null });
}

async function adminDeposits(url, env) {
  const status = ["Pending", "Approved", "Rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "";
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, ""); const like = `%${q}%`; const { from, to } = range(url);
  const r = await env.DB.prepare("SELECT id,user_email,amount_usdt,network,tx_reference,status,admin_note,created_at,reviewed_at FROM deposit_requests WHERE (?='' OR status=?) AND (?='' OR user_email LIKE ? OR tx_reference LIKE ? OR CAST(amount_usdt AS TEXT) LIKE ?) AND created_at BETWEEN ? AND ? ORDER BY id DESC LIMIT 100").bind(status, status, q, like, like, like, from, to).all();
  return out({ ok: true, deposits: r.results || [] });
}
async function adminWithdrawals(url, env) {
  const status = ["Pending", "Approved", "Rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "";
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, ""); const like = `%${q}%`; const { from, to } = range(url);
  const r = await env.DB.prepare("SELECT id,user_email,amount_usdt,status,details,created_at FROM transactions WHERE type='USDT Withdrawal' AND (?='' OR status=?) AND (?='' OR user_email LIKE ? OR details LIKE ? OR CAST(amount_usdt AS TEXT) LIKE ?) AND created_at BETWEEN ? AND ? ORDER BY id DESC LIMIT 100").bind(status, status, q, like, like, like, from, to).all();
  return out({ ok: true, withdrawals: r.results || [] });
}
async function adminPurchases(url, env) {
  const kind = ["purchase", "upgrade"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "";
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, ""); const like = `%${q}%`; const { from, to } = range(url);
  const r = await env.DB.prepare("SELECT id,user_email,vip_level,plan_title,price_usdt,kind,status,started_at,expires_at FROM vip_purchases WHERE (?='' OR kind=?) AND (?='' OR user_email LIKE ? OR plan_title LIKE ?) AND started_at BETWEEN ? AND ? ORDER BY id DESC LIMIT 100").bind(kind, kind, q, like, like, from, to).all();
  const now = Date.now();
  return out({ ok: true, purchases: (r.results || []).map((p) => ({ ...p, status: p.status === "active" && Number(p.expires_at) <= now ? "expired" : p.status })) });
}
async function adminAudit(url, env) {
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, ""); const like = `%${q}%`; const { from, to } = range(url);
  const r = await env.DB.prepare("SELECT id,actor,action,target,details,reason,created_at FROM audit_log WHERE (?='' OR actor LIKE ? OR action LIKE ? OR target LIKE ? OR reason LIKE ?) AND created_at BETWEEN ? AND ? ORDER BY id DESC LIMIT 100").bind(q, like, like, like, like, from, to).all();
  return out({ ok: true, entries: r.results || [] });
}
async function adminHealth(env) {
  const checks = {};
  try { await env.DB.prepare("SELECT 1 AS ok").first(); checks.database = "ok"; } catch (e) { checks.database = `error: ${String(e?.message || e).slice(0, 120)}`; }
  if (!env.UPLOADS) checks.storage = "not configured";
  else { try { await env.UPLOADS.list({ limit: 1 }); checks.storage = "ok"; } catch (e) { checks.storage = `error: ${String(e?.message || e).slice(0, 120)}`; } }
  const tables = {};
  for (const t of ["users", "transactions", "deposit_requests", "vip_plans", "vip_purchases", "notifications", "audit_log", "sessions", "system_events"]) {
    try { tables[t] = Number((await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${t}`).first()).c); } catch { tables[t] = null; }
  }
  const events = await env.DB.prepare("SELECT id,level,message,created_at FROM system_events ORDER BY id DESC LIMIT 40").all();
  const day = Date.now() - DAY_MS;
  const errs = await env.DB.prepare("SELECT level, COUNT(*) AS c FROM system_events WHERE created_at>? GROUP BY level").bind(day).all();
  const trig = await env.DB.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='trigger' AND name LIKE 'audit_no_%'").first().catch(() => null);
  return out({
    ok: true, version: APP_VERSION, worker: "ok", checks, tables,
    audit_protected: Number(trig?.c || 0) === 2,
    last_24h: Object.fromEntries((errs.results || []).map((r) => [r.level, Number(r.c)])),
    events: events.results || [],
    backup: "Cloudflare D1 Time Travel keeps point-in-time restore history. Check your D1 dashboard for the exact retention window.",
    generated_at: Date.now()
  });
}

/* ---------- admin: write APIs ---------- */
async function saveAdminSettings(body, adminEmail, env) {
  if (body.deposit_network !== undefined && !NETWORKS.includes(String(body.deposit_network))) return out({ ok: false, message: "Choose TRC20, BEP20 or ERC20." }, 400);
  for (const key of ["deposit_min", "deposit_max", "withdraw_min"]) { if (body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) <= 0)) return out({ ok: false, message: `${key} must be greater than zero.` }, 400); }
  for (const key of ["withdraw_max", "withdraw_fee", "checkin_reward"]) { if (body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0)) return out({ ok: false, message: `${key} cannot be negative.` }, 400); }
  if (body.checkin_interval_hours !== undefined && !(Number(body.checkin_interval_hours) >= 1 && Number(body.checkin_interval_hours) <= 720)) return out({ ok: false, message: "Claim interval must be between 1 and 720 hours." }, 400);
  if (body.earnings_method !== undefined && !["claim", "auto"].includes(String(body.earnings_method))) return out({ ok: false, message: "Earning method must be claim or auto." }, 400);
  if (body.earnings_frequency_hours !== undefined && !(Number(body.earnings_frequency_hours) >= 1 && Number(body.earnings_frequency_hours) <= 720)) return out({ ok: false, message: "Earning frequency must be between 1 and 720 hours." }, 400);
  if (body.referral_percent !== undefined && !(Number(body.referral_percent) >= 0 && Number(body.referral_percent) <= 100)) return out({ ok: false, message: "Referral percentage must be between 0 and 100." }, 400);
  for (const key of BOOL_KEYS) { if (body[key] !== undefined && !["0", "1"].includes(String(body[key]))) return out({ ok: false, message: `${key} must be 0 or 1.` }, 400); }
  const current = await getSettings(env.DB);
  for (const flag of ["earnings_enabled", "referral_enabled"]) {
    if (String(body[flag]) === "1" && current[flag] !== "1") {
      const missing = await complianceMissing(env.DB, { ...current, ...body });
      if (missing.length) return out({ ok: false, message: `Payouts cannot be enabled yet. Missing: ${missing.join("; ")}.`, missing }, 409);
    }
  }
  const min = Number(body.deposit_min ?? current.deposit_min ?? 1), max = Number(body.deposit_max ?? current.deposit_max ?? 5000);
  if (min > max) return out({ ok: false, message: "Minimum deposit cannot be higher than maximum deposit." }, 400);
  const wmin = Number(body.withdraw_min ?? current.withdraw_min ?? 2), wmax = Number(body.withdraw_max ?? current.withdraw_max ?? 0);
  if (wmax > 0 && wmin > wmax) return out({ ok: false, message: "Minimum withdrawal cannot be higher than maximum withdrawal." }, 400);
  for (const key of ["telegram_url", "whatsapp_url", "live_chat_url"]) { const value = body[key]; if (value && !/^https:\/\//i.test(String(value).trim())) return out({ ok: false, message: `${key} must start with https://` }, 400); }
  const net = String(body.deposit_network ?? current.deposit_network ?? "TRC20");
  const addr = String(body.deposit_address ?? current.deposit_address ?? "").trim();
  if (addr && !validWallet(net, addr)) return out({ ok: false, message: `The deposit address is not a valid ${net} address. Check it carefully.` }, 400);
  const now = Date.now(); const stmts = []; const changes = {};
  for (const key of SETTING_KEYS) {
    if (body[key] === undefined) continue;
    const next = String(body[key]).trim().slice(0, LONG_KEYS.includes(key) ? 20000 : 3000);
    if (next === String(current[key] ?? "")) continue;
    changes[key] = LONG_KEYS.includes(key) ? { changed: true } : { from: String(current[key] ?? "").slice(0, 200), to: next.slice(0, 200) };
    stmts.push(env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at").bind(key, next, now));
  }
  if (stmts.length) { stmts.push(auditStmt(env.DB, adminEmail, "settings.update", Object.keys(changes).join(","), changes, "")); await env.DB.batch(stmts); settingsCache = { at: 0, value: null }; }
  return out({ ok: true, message: "Settings saved." });
}

async function upsertPlan(b, adminEmail, env) {
  const level = Number(b.vip_level), price = money(b.price_usdt), days = Number(b.duration_days), title = String(b.title || `VIP ${level}`).trim().slice(0, 60);
  const description = String(b.description || "").trim().slice(0, 1500);
  const active = b.is_active === undefined ? null : (b.is_active === false || b.is_active === 0 || b.is_active === "0" ? 0 : 1);
  const daily = b.daily_usdt === undefined || b.daily_usdt === "" ? null : money(b.daily_usdt);
  const limit = b.earn_total_limit === undefined || b.earn_total_limit === "" ? null : money(b.earn_total_limit);
  const eStart = b.earn_start_at === undefined ? null : Math.max(0, Number(b.earn_start_at) || 0);
  const eEnd = b.earn_end_at === undefined ? null : Math.max(0, Number(b.earn_end_at) || 0);
  if (!Number.isInteger(level) || level < 1 || !title || !Number.isFinite(price) || price <= 0 || !Number.isInteger(days) || days < 1 || days > 3650) return out({ ok: false, message: "Enter valid product details." }, 400);
  if ((daily !== null && (!Number.isFinite(daily) || daily < 0)) || (limit !== null && (!Number.isFinite(limit) || limit < 0))) return out({ ok: false, message: "Earning amount and limit cannot be negative." }, 400);
  if (eStart && eEnd && eEnd <= eStart) return out({ ok: false, message: "Earning end date must be after the start date." }, 400);
  const prev = await env.DB.prepare("SELECT title,price_usdt,duration_days,is_active,daily_usdt,earn_total_limit,earn_start_at,earn_end_at FROM vip_plans WHERE vip_level=?").bind(level).first();
  const isActive = active === null ? (prev ? Number(prev.is_active) : 1) : active;
  const nd = daily === null ? Number(prev?.daily_usdt || 0) : daily, nl = limit === null ? Number(prev?.earn_total_limit || 0) : limit;
  const ns = eStart === null ? Number(prev?.earn_start_at || 0) : eStart, ne = eEnd === null ? Number(prev?.earn_end_at || 0) : eEnd;
  const rateChanged = prev && (nd !== Number(prev.daily_usdt) || nl !== Number(prev.earn_total_limit) || ns !== Number(prev.earn_start_at) || ne !== Number(prev.earn_end_at));
  const applyExisting = b.apply_to_existing === true;
  if (applyExisting && b.confirm !== true) return out({ ok: false, message: "Confirm that you want to change the terms of members who already bought this plan." }, 400);
  const stmts = [
    env.DB.prepare(`INSERT INTO vip_plans(vip_level,title,price_usdt,daily_usdt,duration_days,description,is_active,earn_start_at,earn_end_at,earn_total_limit,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(vip_level) DO UPDATE SET title=excluded.title,price_usdt=excluded.price_usdt,daily_usdt=excluded.daily_usdt,duration_days=excluded.duration_days,description=excluded.description,is_active=excluded.is_active,earn_start_at=excluded.earn_start_at,earn_end_at=excluded.earn_end_at,earn_total_limit=excluded.earn_total_limit,updated_at=excluded.updated_at`).bind(level, title, price, nd, days, description, isActive, ns, ne, nl, Date.now())
  ];
  if (applyExisting) stmts.push(env.DB.prepare("UPDATE vip_purchases SET daily_usdt=?,earn_limit=?,earn_start_at=?,earn_end_at=? WHERE vip_level=? AND status='active'").bind(nd, nl, ns, ne, level));
  stmts.push(auditStmt(env.DB, adminEmail, prev ? "plan.update" : "plan.create", `level ${level}`, { previous: prev || null, next: { title, price, days, is_active: isActive, daily: nd, limit: nl, start: ns, end: ne }, applied_to_existing: applyExisting }, String(b.reason || "")));
  await env.DB.batch(stmts);
  const note = rateChanged ? (applyExisting ? " Earning terms were also changed for members who already hold this plan." : " Earning terms apply to NEW purchases only; existing members keep their agreed terms.") : "";
  return out({ ok: true, message: "Product saved." + note });
}
async function deletePlan(b, adminEmail, env) {
  const level = Number(b.vip_level);
  if (!Number.isInteger(level)) return out({ ok: false, message: "Invalid product." }, 400);
  const used = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM vip_purchases WHERE vip_level=?) AS p, (SELECT COUNT(*) FROM users WHERE vip_level=? AND vip_expires_at>?) AS u").bind(level, level, Date.now()).first();
  if (Number(used.p) > 0 || Number(used.u) > 0) return out({ ok: false, message: "This plan has purchase records, so it cannot be deleted. Deactivate it instead." }, 409);
  await env.DB.batch([env.DB.prepare("DELETE FROM vip_plans WHERE vip_level=?").bind(level), auditStmt(env.DB, adminEmail, "plan.delete", `level ${level}`, {}, "")]);
  return out({ ok: true, message: "Product removed." });
}
async function addSuperAdmin(b, adminEmail, env) {
  const email = cleanEmail(b.newAdminEmail);
  if (!EMAIL_RE.test(email)) return out({ ok: false, message: "Enter a valid admin email." }, 400);
  await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO super_admins(email,role,added_by,created_at) VALUES(?,'SUPER_ADMIN',?,?)").bind(email, adminEmail, Date.now()), auditStmt(env.DB, adminEmail, "admin.add", email, {}, "")]);
  return out({ ok: true, message: "Admin added." });
}
async function removeSuperAdmin(b, adminEmail, env) {
  const email = cleanEmail(b.email);
  if (!email || email === cleanEmail(env.PRIMARY_ADMIN_EMAIL) || email === cleanEmail(adminEmail)) return out({ ok: false, message: "The primary owner and your current admin account cannot be removed here." }, 400);
  await env.DB.batch([env.DB.prepare("DELETE FROM super_admins WHERE email=?").bind(email), auditStmt(env.DB, adminEmail, "admin.remove", email, {}, "")]);
  return out({ ok: true, message: "Admin access removed." });
}

async function decideWithdrawal(b, adminEmail, env) {
  const id = Number(b.txId), decision = b.decision === "Approved" ? "Approved" : b.decision === "Rejected" ? "Rejected" : ""; const note = String(b.note || "").slice(0, 300);
  if (!id || !decision) return out({ ok: false, message: "Invalid withdrawal decision." }, 400);
  const tx = await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND type='USDT Withdrawal'").bind(id).first();
  if (!tx || tx.status !== "Pending") return out({ ok: false, message: "Pending withdrawal not found." }, 404);
  const log = auditStmt(env.DB, adminEmail, `withdrawal.${decision.toLowerCase()}`, tx.user_email, { tx_id: id, amount: tx.amount_usdt }, note);
  const suffix = note ? ` • Note: ${note}` : "";
  if (decision === "Rejected") {
    const refundToken = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE transactions SET status='Rejected',details=details || ? WHERE id=? AND status='Pending'").bind(` • Rejected by ${adminEmail}${suffix} [${refundToken}]`, id),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt + ?,2) WHERE email=? AND EXISTS(SELECT 1 FROM transactions WHERE id=? AND status='Rejected' AND details LIKE ?)").bind(tx.amount_usdt, tx.user_email, id, `%${refundToken}%`),
      log
    ]);
  } else await env.DB.batch([env.DB.prepare("UPDATE transactions SET status='Approved',details=details || ? WHERE id=? AND status='Pending'").bind(` • Approved by ${adminEmail}${suffix}`, id), log]);
  await notify(env.DB, tx.user_email, decision === "Approved" ? "Withdrawal approved" : "Withdrawal rejected",
    decision === "Approved" ? `Your withdrawal of ${Number(tx.amount_usdt).toFixed(2)} USDT has been approved and sent.` : `Your withdrawal of ${Number(tx.amount_usdt).toFixed(2)} USDT was rejected and the amount was returned to your balance.${note ? " Reason: " + note : ""}`);
  return out({ ok: true, message: `Withdrawal ${decision.toLowerCase()}.` });
}

async function userAction(b, adminEmail, env) {
  const email = cleanEmail(b.email); const action = String(b.action || ""); const reason = String(b.reason || b.note || "").slice(0, 500);
  if (!["ban", "unban", "reset-pin", "freeze-withdrawals", "unfreeze-withdrawals", "save-note"].includes(action)) return out({ ok: false, message: "Invalid action." }, 400);
  const target = await env.DB.prepare("SELECT email FROM users WHERE email=?").bind(email).first();
  if (!target) return out({ ok: false, message: "Member not found." }, 404);
  const log = (extra) => auditStmt(env.DB, adminEmail, `user.${action}`, email, extra || {}, reason);
  if (action === "ban") {
    if (email === cleanEmail(adminEmail) || await isAdmin(email, env.DB)) return out({ ok: false, message: "An administrator account cannot be suspended here." }, 400);
    await env.DB.batch([env.DB.prepare("UPDATE users SET is_banned=1 WHERE email=?").bind(email), env.DB.prepare("DELETE FROM sessions WHERE user_email=?").bind(email), log()]);
    return out({ ok: true, message: "Member suspended and signed out." });
  }
  if (action === "unban") { await env.DB.batch([env.DB.prepare("UPDATE users SET is_banned=0 WHERE email=?").bind(email), log()]); return out({ ok: true, message: "Member re-activated." }); }
  if (action === "freeze-withdrawals") { await env.DB.batch([env.DB.prepare("UPDATE users SET withdraw_frozen=1 WHERE email=?").bind(email), log()]); return out({ ok: true, message: "Withdrawals frozen for this member." }); }
  if (action === "unfreeze-withdrawals") { await env.DB.batch([env.DB.prepare("UPDATE users SET withdraw_frozen=0 WHERE email=?").bind(email), log()]); return out({ ok: true, message: "Withdrawals unfrozen." }); }
  if (action === "save-note") { await env.DB.batch([env.DB.prepare("UPDATE users SET admin_note=? WHERE email=?").bind(String(b.note || "").slice(0, 1000), email), log({ length: String(b.note || "").length })]); return out({ ok: true, message: "Note saved." }); }
  await env.DB.batch([env.DB.prepare("UPDATE users SET withdraw_pin='' WHERE email=?").bind(email), env.DB.prepare("DELETE FROM rate_limits WHERE key=?").bind(`pin:${email}`), log()]);
  return out({ ok: true, message: "Transaction PIN cleared. The member must set a new one." });
}

async function adjustBalance(b, adminEmail, env) {
  const email = cleanEmail(b.email); const type = b.type === "debit" ? "debit" : b.type === "credit" ? "credit" : "";
  const amount = money(b.amount); const reason = String(b.reason || "").trim();
  if (!type || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) return out({ ok: false, message: "Choose credit or debit and enter a valid amount." }, 400);
  if (reason.length < 5) return out({ ok: false, message: "A reason of at least 5 characters is required." }, 400);
  if (b.confirm !== true) return out({ ok: false, message: "Confirmation is required." }, 400);
  if (email === cleanEmail(adminEmail)) return out({ ok: false, message: "You cannot adjust your own balance." }, 403);
  const u = await env.DB.prepare("SELECT balance_usdt FROM users WHERE email=?").bind(email).first();
  if (!u) return out({ ok: false, message: "Member not found." }, 404);
  const prev = money(u.balance_usdt); const next = type === "credit" ? money(prev + amount) : money(prev - amount);
  if (next < 0) return out({ ok: false, message: "This debit would make the balance negative." }, 400);
  // Audit row, transaction record and balance change run in one transaction with one shared condition.
  const cond = type === "debit" ? "email=? AND balance_usdt>=?" : "email=? AND ?>=0";
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO audit_log(actor,action,target,details,reason,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE ${cond})`).bind(adminEmail, `balance.${type}`, email, JSON.stringify({ previous: prev, amount, next }), reason.slice(0, 500), Date.now(), email, amount),
    env.DB.prepare(`INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,?,?,'Approved',?,? WHERE EXISTS(SELECT 1 FROM users WHERE ${cond})`).bind(email, type === "credit" ? "Admin Credit" : "Admin Debit", amount, `Adjusted by ${adminEmail}: ${reason.slice(0, 200)}`, Date.now(), email, amount),
    env.DB.prepare(`UPDATE users SET balance_usdt=ROUND(balance_usdt ${type === "credit" ? "+" : "-"} ?,2) WHERE ${cond}`).bind(amount, email, amount)
  ]);
  if (!res[2].meta?.changes) return out({ ok: false, message: "Balance changed in the meantime. Reload and try again." }, 409);
  await notify(env.DB, email, type === "credit" ? "Balance credited" : "Balance debited", `${amount.toFixed(2)} USDT was ${type === "credit" ? "added to" : "removed from"} your balance by the administrator. Reason: ${reason.slice(0, 200)}`);
  return out({ ok: true, message: `Balance ${type}ed.`, previous: prev, next });
}

/* ---------- member actions ---------- */
async function savePaymentMethod(b, user, env) {
  const addr = String(b.wallet_address || "").trim(), net = String(b.wallet_network || "").trim();
  if (!NETWORKS.includes(net) || !validWallet(net, addr)) return out({ ok: false, message: `Enter a valid ${net || "USDT"} wallet address for the selected network.` }, 400);
  await env.DB.prepare("UPDATE users SET wallet_address=?,wallet_network=? WHERE email=?").bind(addr, net, user.email).run();
  await logActivity(env.DB, user.email, `Withdrawal wallet saved (${net})`);
  return out({ ok: true, message: "Withdrawal wallet saved." });
}

async function savePin(b, user, env) {
  const pin = String(b.pin || "");
  if (!/^\d{4}$/.test(pin)) return out({ ok: false, message: "PIN must be exactly 4 digits." }, 400);
  await env.DB.prepare("UPDATE users SET withdraw_pin=? WHERE email=?").bind(await hashPassword(pin), user.email).run();
  await logActivity(env.DB, user.email, user.has_pin ? "Transaction PIN changed" : "Transaction PIN created");
  return out({ ok: true, message: "Transaction PIN saved securely." });
}

async function requestWithdrawal(b, user, env) {
  const db = env.DB; const amount = money(b.amount), pin = String(b.pin || "");
  const cfg = await getSettings(db);
  if (cfg.withdrawals_enabled === "0") return out({ ok: false, message: "Withdrawals are temporarily unavailable." }, 503);
  if (user.withdraw_frozen) return out({ ok: false, message: "Withdrawals are frozen on your account. Please contact support." }, 403);
  if (!Number.isFinite(amount) || amount <= 0) return out({ ok: false, message: "Enter a valid amount." }, 400);
  const pinKey = `pin:${user.email}`;
  if ((await hits(db, pinKey)) >= 5) { await logEvent(db, "security", `PIN lockout for ${user.email}`); return out({ ok: false, message: "Too many incorrect PIN attempts. Try again in 30 minutes." }, 429); }
  const record = await db.prepare("SELECT wallet_address,wallet_network,withdraw_pin FROM users WHERE email=?").bind(user.email).first();
  if (!record.wallet_address) return out({ ok: false, message: "Save your withdrawal wallet first." }, 400);
  if (!record.withdraw_pin) return out({ ok: false, message: "Set your 4-digit security PIN first." }, 400);
  if (!(await verifyPassword(pin, record.withdraw_pin))) { await hit(db, pinKey, 30 * MIN_MS); return out({ ok: false, message: "Incorrect transaction PIN." }, 403); }
  await clearHits(db, pinKey);
  const min = Number(cfg.withdraw_min || 2), max = Number(cfg.withdraw_max || 0), fee = money(cfg.withdraw_fee || 0);
  if (amount < min) return out({ ok: false, message: `Withdrawal minimum is ${min} USDT.` }, 400);
  if (max > 0 && amount > max) return out({ ok: false, message: `Withdrawal maximum is ${max} USDT per request.` }, 400);
  if (amount <= fee) return out({ ok: false, message: `The amount must be higher than the ${fee} USDT withdrawal fee.` }, 400);
  const net = money(amount - fee);
  const details = `Reserved for ${record.wallet_network}: ${record.wallet_address}${fee > 0 ? ` • Fee ${fee.toFixed(2)} • Net ${net.toFixed(2)}` : ""}`;
  // Both statements run in one transaction and share the same balance condition.
  const res = await db.batch([
    db.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,'USDT Withdrawal',?,'Pending',?,? WHERE EXISTS(SELECT 1 FROM users WHERE email=? AND balance_usdt>=?)").bind(user.email, amount, details, Date.now(), user.email, amount),
    db.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt-?,2) WHERE email=? AND balance_usdt>=?").bind(amount, user.email, amount)
  ]);
  if (!res[1].meta?.changes) return out({ ok: false, message: "Insufficient balance." }, 400);
  return out({ ok: true, message: "Withdrawal request submitted for admin review." });
}

async function buyPlan(b, user, env) {
  const cfg = await getSettings(env.DB);
  if (cfg.vip_purchases_enabled === "0") return out({ ok: false, message: "Plan purchases are temporarily unavailable." }, 503);
  const p = await env.DB.prepare("SELECT * FROM vip_plans WHERE vip_level=? AND is_active=1").bind(Number(b.vip)).first();
  if (!p) return out({ ok: false, message: "This plan is not available." }, 404);
  const now = Date.now(); const expires = now + Number(p.duration_days) * DAY_MS;
  const kind = Number(user.vip_level) > 0 ? "upgrade" : "purchase";
  const cond = "email=? AND is_banned=0 AND balance_usdt>=? AND (vip_level<? OR COALESCE(vip_expires_at,0)<=?)";
  const cb = [user.email, p.price_usdt, p.vip_level, now];
  // One transaction: record the sale, retire the previous plan, create the single active plan, then take the money.
  // Every step shares the same condition, and a unique index forbids two active plans per member.
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,?,?,'Approved',?,? WHERE EXISTS(SELECT 1 FROM users WHERE ${cond})`).bind(user.email, `${p.title} ${kind === "upgrade" ? "Upgrade" : "Purchase"}`, p.price_usdt, kind === "upgrade" ? "Plan upgrade" : "Plan purchase", now, ...cb),
    env.DB.prepare(`UPDATE vip_purchases SET status=CASE WHEN expires_at<=? THEN 'expired' ELSE 'replaced' END, ended_at=? WHERE user_email=? AND status='active' AND EXISTS(SELECT 1 FROM users WHERE ${cond})`).bind(now, now, user.email, ...cb),
    env.DB.prepare(`INSERT INTO vip_purchases(user_email,vip_level,plan_title,price_usdt,kind,status,started_at,expires_at,daily_usdt,earn_limit,earn_start_at,earn_end_at) SELECT ?,?,?,?,?,'active',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE ${cond})`).bind(user.email, p.vip_level, p.title, p.price_usdt, kind, now, expires, p.daily_usdt, p.earn_total_limit, p.earn_start_at, p.earn_end_at, ...cb),
    env.DB.prepare(`UPDATE users SET balance_usdt=ROUND(balance_usdt-?,2),vip_level=?,vip_expires_at=? WHERE ${cond}`).bind(p.price_usdt, p.vip_level, expires, ...cb)
  ]);
  if (!res[3].meta?.changes) {
    const u = await env.DB.prepare("SELECT balance_usdt FROM users WHERE email=?").bind(user.email).first();
    return out({ ok: false, message: Number(u?.balance_usdt || 0) < Number(p.price_usdt) ? "Insufficient balance." : "Choose a higher plan level." }, 400);
  }
  try { await createCommission(env, user, p, kind); } catch (e) { console.error("commission failed", e); await logEvent(env.DB, "error", `Commission creation failed for ${user.email}: ${String(e?.message || e).slice(0, 200)}`); }
  return out({ ok: true, message: `${p.title} activated.` });
}

async function checkin(user, env) {
  const cfg = await getSettings(env.DB);
  const reward = money(cfg.checkin_reward || 0);
  if (cfg.checkin_enabled === "0" || !(reward > 0)) return out({ ok: false, message: "Daily check-in is currently disabled." }, 400);
  if (cfg.checkin_requires_vip !== "0" && Number(user.vip_level) <= 0) { return out({ ok: false, message: "Activate a plan to use the daily check-in." }, 403); }
  const intervalMs = Math.max(1, Number(cfg.checkin_interval_hours || 24)) * HOUR_MS;
  const now = Date.now(), cutoff = now - intervalMs;
  const res = await env.DB.batch([
    env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,'Daily Check-in',?,'Approved','Daily check-in credit',? WHERE EXISTS(SELECT 1 FROM users WHERE email=? AND COALESCE(last_checkin_ms,0)<=?)").bind(user.email, reward, now, user.email, cutoff),
    env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt+?,2),last_checkin_ms=?,checkin_count=checkin_count+1 WHERE email=? AND COALESCE(last_checkin_ms,0)<=?").bind(reward, now, user.email, cutoff)
  ]);
  if (!res[1].meta?.changes) return out({ ok: false, message: "Daily check-in is not available yet." }, 400);
  return out({ ok: true, message: "Check-in recorded." });
}

/* ---------- activity, notifications, password ---------- */
async function logActivity(db, email, text) {
  await db.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) VALUES(?,'Account Activity',0,'Approved',?,?)").bind(email, text, Date.now()).run();
}
async function notify(db, email, title, body) {
  try { await db.prepare("INSERT INTO notifications(user_email,title,body,created_by,created_at) VALUES(?,?,?,'SYSTEM',?)").bind(email, title, body, Date.now()).run(); } catch (e) { console.error("notify failed", e); }
}

async function listNotifications(user, env) {
  const seen = await env.DB.prepare("SELECT notif_seen_at FROM users WHERE email=?").bind(user.email).first();
  const seenAt = Number(seen?.notif_seen_at || 0);
  const r = await env.DB.prepare("SELECT id,title,body,created_at FROM notifications WHERE user_email=? OR (user_email IS NULL AND created_at>=?) ORDER BY id DESC LIMIT 50").bind(user.email, user.created_at).all();
  return out({ ok: true, notifications: (r.results || []).map((n) => ({ ...n, is_new: Number(n.created_at) > seenAt })) });
}
async function markNotificationsSeen(user, env) {
  await env.DB.prepare("UPDATE users SET notif_seen_at=? WHERE email=?").bind(Date.now(), user.email).run();
  return out({ ok: true });
}
async function sendNotification(b, adminEmail, env) {
  const title = String(b.title || "").trim().slice(0, 80), body = String(b.body || "").trim().slice(0, 500);
  if (!title) return out({ ok: false, message: "Enter a notification title." }, 400);
  let target = null;
  if (b.audience === "user") {
    target = cleanEmail(b.email);
    if (!(await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(target).first())) return out({ ok: false, message: "No member with that email." }, 404);
  }
  await env.DB.batch([env.DB.prepare("INSERT INTO notifications(user_email,title,body,created_by,created_at) VALUES(?,?,?,?,?)").bind(target, title, body, adminEmail, Date.now()), auditStmt(env.DB, adminEmail, "notification.send", target || "all", { title }, "")]);
  return out({ ok: true, message: target ? "Notification sent to the member." : "Notification sent to all members." });
}
async function deleteNotification(b, adminEmail, env) {
  const id = Number(b.id);
  if (!Number.isInteger(id)) return out({ ok: false, message: "Invalid notification." }, 400);
  await env.DB.batch([env.DB.prepare("DELETE FROM notifications WHERE id=? AND created_by<>'SYSTEM'").bind(id), auditStmt(env.DB, adminEmail, "notification.delete", String(id), {}, "")]);
  return out({ ok: true, message: "Notification deleted." });
}

async function changePassword(b, user, request, env) {
  const db = env.DB; const cur = String(b.current_password || ""), next = String(b.new_password || "");
  if (next.length < 8 || next.length > 200) return out({ ok: false, message: "New password must be at least 8 characters." }, 400);
  const key = `pw:${user.email}`;
  if ((await hits(db, key)) >= 5) return out({ ok: false, message: "Too many attempts. Try again in 30 minutes." }, 429);
  const row = await db.prepare("SELECT password_hash FROM users WHERE email=?").bind(user.email).first();
  if (!row || !(await verifyPassword(cur, row.password_hash))) { await hit(db, key, 30 * MIN_MS); return out({ ok: false, message: "Current password is incorrect." }, 403); }
  await clearHits(db, key);
  await db.batch([
    db.prepare("UPDATE users SET password_hash=? WHERE email=?").bind(await hashPassword(next), user.email),
    db.prepare("DELETE FROM sessions WHERE user_email=? AND token_hash<>?").bind(user.email, await sha256(bearer(request)))
  ]);
  await logActivity(db, user.email, "Password changed (other devices signed out)");
  return out({ ok: true, message: "Password changed. Other devices were signed out." });
}
async function logoutAll(user, env) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_email=?").bind(user.email).run();
  return out({ ok: true, message: "Signed out of all devices." });
}


/* ---------- company profile ---------- */
async function companyPublic(env) {
  const cfg = await getSettings(env.DB);
  const profile = Object.fromEntries([...COMPANY_KEYS, "company_logo_key"].map((k) => [k, cfg[k] || ""]));
  const docs = await env.DB.prepare("SELECT id,title,file_key,content_type,created_at FROM company_documents ORDER BY id DESC").all();
  return out({ ok: true, profile, documents: docs.results || [] });
}
async function uploadCompanyFile(request, adminEmail, env) {
  if (!env.UPLOADS) return out({ ok: false, message: "R2 file storage is not configured." }, 503);
  let form; try { form = await request.formData(); } catch { return out({ ok: false, message: "Invalid form data." }, 400); }
  const kind = String(form.get("kind") || ""); const file = form.get("file"); const title = String(form.get("title") || "").trim().slice(0, 100);
  if (!["logo", "document"].includes(kind)) return out({ ok: false, message: "Invalid upload type." }, 400);
  if (!file || typeof file.arrayBuffer !== "function" || file.size > (kind === "logo" ? MAX_PROOF_BYTES : 8 * 1024 * 1024)) return out({ ok: false, message: kind === "logo" ? "Upload a JPG, PNG or WEBP logo up to 3 MB." : "Upload a PDF, JPG, PNG or WEBP up to 8 MB." }, 400);
  const buf = await file.arrayBuffer(); const f = kind === "logo" ? sniffImage(buf) : sniffDoc(buf);
  if (!f) return out({ ok: false, message: kind === "logo" ? "Logo must be a JPG, PNG or WEBP image." : "Document must be a PDF, JPG, PNG or WEBP." }, 400);
  if (kind === "document" && !title) return out({ ok: false, message: "Enter a title for the document." }, 400);
  const key = `company/${Date.now()}-${crypto.randomUUID()}.${f.ext}`;
  await env.UPLOADS.put(key, buf, { httpMetadata: { contentType: f.type } });
  if (kind === "logo") {
    const old = await env.DB.prepare("SELECT setting_value FROM site_settings WHERE setting_key='company_logo_key'").first();
    await env.DB.batch([env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES('company_logo_key',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at").bind(key, Date.now()), auditStmt(env.DB, adminEmail, "company.logo", "company_logo_key", { next: key }, "")]);
    if (old?.setting_value) { try { await env.UPLOADS.delete(old.setting_value); } catch { /* ignore */ } }
    settingsCache = { at: 0, value: null };
    return out({ ok: true, message: "Company logo updated." });
  }
  await env.DB.batch([env.DB.prepare("INSERT INTO company_documents(title,file_key,content_type,uploaded_by,created_at) VALUES(?,?,?,?,?)").bind(title, key, f.type, adminEmail, Date.now()), auditStmt(env.DB, adminEmail, "company.document.add", title, { key }, "")]);
  return out({ ok: true, message: "Document published." });
}
async function deleteCompanyDoc(b, adminEmail, env) {
  const id = Number(b.id); const d = await env.DB.prepare("SELECT title,file_key FROM company_documents WHERE id=?").bind(id).first();
  if (!d) return out({ ok: false, message: "Document not found." }, 404);
  await env.DB.batch([env.DB.prepare("DELETE FROM company_documents WHERE id=?").bind(id), auditStmt(env.DB, adminEmail, "company.document.delete", d.title, {}, "")]);
  try { await env.UPLOADS?.delete(d.file_key); } catch { /* ignore */ }
  return out({ ok: true, message: "Document removed." });
}

/* ---------- payout compliance gate and funding ledger ---------- */
async function complianceMissing(db, cfg) {
  const need = [["company_legal_name", "registered company name"], ["cac_number", "CAC registration number"], ["company_address", "company address"], ["license_info", "licence or regulatory approval details (e.g. SEC Nigeria)"], ["revenue_model", "how the business generates revenue"], ["earnings_funding", "how VIP earnings are funded"], ["terms_text", "terms and conditions"]];
  const missing = need.filter(([k]) => !String(cfg[k] || "").trim()).map((x) => x[1]);
  const docs = await db.prepare("SELECT COUNT(*) AS c FROM company_documents").first();
  if (!Number(docs?.c)) missing.push("at least one uploaded official company document (e.g. CAC certificate)");
  return missing;
}
async function poolBalance(db) { const r = await db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM funding_ledger").first(); return money(r.s); }

async function fundAllocation(b, adminEmail, env) {
  const amount = money(b.amount), reference = String(b.reference || "").trim(), note = String(b.note || "").trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return out({ ok: false, message: "Enter a valid amount." }, 400);
  if (reference.length < 3 || note.length < 5) return out({ ok: false, message: "A document/bank reference and a description of the revenue source are required." }, 400);
  if (b.confirm !== true) return out({ ok: false, message: "Confirmation is required." }, 400);
  const ref = `alloc:${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO funding_ledger(kind,amount,ref,note,actor,created_at) VALUES('revenue_allocation',?,?,?,?,?)").bind(amount, ref, `${reference} — ${note}`.slice(0, 500), adminEmail, Date.now()),
    auditStmt(env.DB, adminEmail, "ledger.allocation", ref, { amount, reference }, note)
  ]);
  return out({ ok: true, message: "Verified revenue allocated to the payout fund.", pool: await poolBalance(env.DB) });
}
async function ledgerCorrection(b, adminEmail, env) {
  const amount = money(b.amount), reason = String(b.reason || "").trim();
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1e9) return out({ ok: false, message: "Enter a valid non-zero amount." }, 400);
  if (reason.length < 5) return out({ ok: false, message: "A reason is required." }, 400);
  if (b.confirm !== true) return out({ ok: false, message: "Confirmation is required." }, 400);
  const ref = `corr:${crypto.randomUUID()}`;
  const res = await env.DB.batch([
    env.DB.prepare("INSERT INTO funding_ledger(kind,amount,ref,note,actor,created_at) SELECT 'correction',?,?,?,?,? WHERE (SELECT COALESCE(SUM(amount),0) FROM funding_ledger)+?>=0").bind(amount, ref, reason.slice(0, 500), adminEmail, Date.now(), amount),
    auditStmt(env.DB, adminEmail, "ledger.correction", ref, { amount }, reason)
  ]);
  if (!res[0].meta?.changes) return out({ ok: false, message: "This correction would make the payout fund negative." }, 400);
  return out({ ok: true, message: "Correction recorded.", pool: await poolBalance(env.DB) });
}

/* ---------- daily earnings (claim or automatic) ---------- */
function earnStatus(p, cfg, now) {
  const freqMs = Math.max(1, Number(cfg.earnings_frequency_hours || 24)) * HOUR_MS;
  if (cfg.earnings_enabled !== "1") return { ok: false, code: "disabled", message: "Daily earnings are not enabled." };
  if (p.status !== "active" || Number(p.expires_at) <= now) return { ok: false, code: "inactive", message: "Your plan is not active." };
  if (Number(p.earn_paused)) return { ok: false, code: "paused", message: "Earnings for your plan are paused by the administrator." };
  if (!(Number(p.daily_usdt) > 0)) return { ok: false, code: "none", message: "This plan has no daily earning configured." };
  if (Number(p.earn_start_at) && now < Number(p.earn_start_at)) return { ok: false, code: "early", message: "Earnings have not started yet." };
  if (Number(p.earn_end_at) && now > Number(p.earn_end_at)) return { ok: false, code: "ended", message: "The earning period has ended." };
  const remaining = Number(p.earn_limit) > 0 ? money(Number(p.earn_limit) - Number(p.earned_total)) : Infinity;
  if (remaining <= 0) return { ok: false, code: "limit", message: "The total earning limit for this plan has been reached." };
  const base = Math.max(Number(p.last_earn_ms) || 0, Number(p.started_at) || 0, Number(p.earn_start_at) || 0);
  const next = base + freqMs;
  if (now < next) return { ok: false, code: "wait", next, message: "Your next earning is not available yet." };
  return { ok: true, amount: money(Math.min(Number(p.daily_usdt), remaining)), cutoff: now - freqMs };
}
async function creditEarning(env, p, cfg, actor) {
  const now = Date.now(); const st = earnStatus(p, cfg, now);
  if (!st.ok) return st;
  const missing = await complianceMissing(env.DB, cfg);
  if (missing.length) return { ok: false, code: "compliance", message: "Payouts are suspended until the company documentation is complete." };
  const n = Number(p.earn_claims) + 1, ref = `earn:${p.id}:${n}`, amt = st.amount;
  const cond = "id=? AND status='active' AND expires_at>? AND earn_paused=0 AND earn_claims=? AND last_earn_ms<=?";
  const cb = [p.id, now, Number(p.earn_claims), st.cutoff];
  let res;
  try {
    res = await env.DB.batch([
      env.DB.prepare(`INSERT INTO funding_ledger(kind,amount,ref,note,actor,created_at) SELECT 'earning_payout',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM vip_purchases WHERE ${cond}) AND EXISTS(SELECT 1 FROM users WHERE email=? AND is_banned=0) AND (SELECT COALESCE(SUM(amount),0) FROM funding_ledger)>=?`).bind(-amt, ref, `${p.user_email} #${n}`, actor, now, ...cb, p.user_email, amt),
      env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,'Daily Earning',?,'Approved',?,? WHERE EXISTS(SELECT 1 FROM funding_ledger WHERE ref=?)").bind(p.user_email, amt, `Daily earning #${n} • ${p.plan_title}`, now, ref),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt+?,2) WHERE email=? AND EXISTS(SELECT 1 FROM funding_ledger WHERE ref=?)").bind(amt, p.user_email, ref),
      env.DB.prepare(`UPDATE vip_purchases SET earned_total=ROUND(earned_total+?,2),earn_claims=?,last_earn_ms=? WHERE ${cond} AND EXISTS(SELECT 1 FROM funding_ledger WHERE ref=?)`).bind(amt, n, now, ...cb, ref)
    ]);
  } catch { return { ok: false, code: "duplicate", message: "This earning was already credited." }; }
  if (!res[0].meta?.changes) {
    const pool = await poolBalance(env.DB);
    if (pool < amt) { await logEvent(env.DB, "warning", `Earning pending: payout fund ${pool} is below ${amt}`); return { ok: false, code: "pending", message: "Your earning is pending: the company payout fund is currently insufficient. It will be available once funding is confirmed." }; }
    return { ok: false, code: "not-eligible", message: "Earning is not available right now." };
  }
  return { ok: true, amount: amt, message: `${amt.toFixed(2)} USDT earning credited.` };
}
async function claimEarning(user, env) {
  const cfg = await getSettings(env.DB);
  if (cfg.earnings_method !== "claim") return out({ ok: false, message: "Earnings are credited automatically; manual claim is off." }, 400);
  const p = await env.DB.prepare("SELECT * FROM vip_purchases WHERE user_email=? AND status='active' AND expires_at>?").bind(user.email, Date.now()).first();
  if (!p) return out({ ok: false, message: "You need an active plan to claim earnings." }, 403);
  const r = await creditEarning(env, p, cfg, user.email);
  return out({ ok: r.ok, message: r.message, code: r.code }, r.ok ? 200 : (r.code === "pending" ? 202 : 400));
}
async function processAutoEarnings(env, actor) {
  const cfg = await getSettings(env.DB);
  if (cfg.earnings_enabled !== "1" || cfg.earnings_method !== "auto") return { ok: true, processed: 0, message: "Automatic earnings are not active." };
  const rows = await env.DB.prepare("SELECT * FROM vip_purchases WHERE status='active' AND expires_at>? AND earn_paused=0 AND daily_usdt>0 ORDER BY id LIMIT 300").bind(Date.now()).all();
  let credited = 0, pending = 0;
  for (const p of rows.results || []) { const r = await creditEarning(env, p, cfg, actor); if (r.ok) credited++; else if (r.code === "pending") { pending++; break; } }
  if (actor !== "SYSTEM") await audit(env.DB, actor, "earnings.run", "auto", { credited, pending }, "");
  return { ok: true, processed: credited, pending, message: `${credited} earning(s) credited${pending ? "; stopped because the payout fund is insufficient" : ""}.` };
}
async function pauseEarning(b, adminEmail, env) {
  const id = Number(b.purchaseId), paused = b.paused === true ? 1 : 0, reason = String(b.reason || "").trim();
  if (!id || reason.length < 3) return out({ ok: false, message: "A purchase and a reason are required." }, 400);
  const p = await env.DB.prepare("SELECT user_email FROM vip_purchases WHERE id=?").bind(id).first();
  if (!p) return out({ ok: false, message: "Purchase not found." }, 404);
  await env.DB.batch([env.DB.prepare("UPDATE vip_purchases SET earn_paused=? WHERE id=?").bind(paused, id), auditStmt(env.DB, adminEmail, paused ? "earnings.pause" : "earnings.resume", p.user_email, { purchase_id: id }, reason)]);
  return out({ ok: true, message: paused ? "Earning schedule paused." : "Earning schedule resumed." });
}
async function adminEarnings(url, env) {
  const cfg = await getSettings(env.DB); const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, ""); const like = `%${q}%`; const { from, to } = range(url);
  const [tot, ledger, sched, ptot, ctot] = await Promise.all([
    env.DB.prepare("SELECT kind, COALESCE(SUM(amount),0) AS s FROM funding_ledger GROUP BY kind").all(),
    env.DB.prepare("SELECT id,kind,amount,ref,note,actor,created_at FROM funding_ledger WHERE (?='' OR note LIKE ? OR kind LIKE ? OR actor LIKE ?) AND created_at BETWEEN ? AND ? ORDER BY id DESC LIMIT 100").bind(q, like, like, like, from, to).all(),
    env.DB.prepare("SELECT id,user_email,plan_title,daily_usdt,earn_limit,earned_total,earn_claims,last_earn_ms,earn_paused,expires_at FROM vip_purchases WHERE status='active' AND expires_at>? AND (?='' OR user_email LIKE ?) ORDER BY id DESC LIMIT 100").bind(Date.now(), q, like).all(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM transactions WHERE type='Daily Earning'").first(),
    env.DB.prepare("SELECT status, COUNT(*) AS c, COALESCE(SUM(amount_usdt),0) AS s FROM referral_commissions GROUP BY status").all()
  ]);
  const byKind = Object.fromEntries((tot.results || []).map((r) => [r.kind, money(r.s)]));
  return out({ ok: true, pool: money(Object.values(byKind).reduce((a, b) => a + b, 0)), allocated: byKind.revenue_allocation || 0, paid_earnings: Math.abs(byKind.earning_payout || 0), paid_commissions: Math.abs(byKind.commission_payout || 0), earning_credits: Number(ptot?.c || 0), commissions: Object.fromEntries((ctot.results || []).map((r) => [r.status, { count: Number(r.c), total: money(r.s) }])), missing: await complianceMissing(env.DB, cfg), settings: { earnings_enabled: cfg.earnings_enabled, earnings_method: cfg.earnings_method, earnings_frequency_hours: cfg.earnings_frequency_hours, referral_enabled: cfg.referral_enabled, referral_percent: cfg.referral_percent, referral_manual_approval: cfg.referral_manual_approval, referral_on_upgrades: cfg.referral_on_upgrades }, ledger: ledger.results || [], schedules: sched.results || [] });
}

/* ---------- referral commissions (direct referrals only) ---------- */
async function createCommission(env, buyer, plan, kind) {
  const cfg = await getSettings(env.DB);
  if (cfg.referral_enabled !== "1") return;
  const percent = Number(cfg.referral_percent || 0);
  if (!(percent > 0)) return;
  if (kind === "upgrade" && cfg.referral_on_upgrades !== "1") return;
  const code = String(buyer.referral_code || ""); if (!code) return;
  const referrer = await env.DB.prepare("SELECT email,is_banned FROM users WHERE custom_id=?").bind(code).first();
  if (!referrer || referrer.is_banned || cleanEmail(referrer.email) === cleanEmail(buyer.email)) return;
  const pur = await env.DB.prepare("SELECT id FROM vip_purchases WHERE user_email=? AND status='active' ORDER BY id DESC LIMIT 1").bind(buyer.email).first();
  if (!pur) return;
  const amount = money(Number(plan.price_usdt) * percent / 100);
  if (!(amount > 0)) return;
  const res = await env.DB.prepare("INSERT OR IGNORE INTO referral_commissions(referrer_email,referred_email,purchase_id,base_usdt,percent,amount_usdt,status,created_at) VALUES(?,?,?,?,?,?,'Pending',?)").bind(referrer.email, buyer.email, pur.id, plan.price_usdt, percent, amount, Date.now()).run();
  if (res.meta?.changes && cfg.referral_manual_approval === "0") await payCommission(env, res.meta.last_row_id, "SYSTEM", "");
}
async function payCommission(env, id, actor, note) {
  const c = await env.DB.prepare("SELECT * FROM referral_commissions WHERE id=?").bind(id).first();
  if (!c || c.status !== "Pending") return { ok: false, code: "state", message: "Commission is not pending." };
  const missing = await complianceMissing(env.DB, await getSettings(env.DB));
  if (missing.length) return { ok: false, code: "compliance", message: "Payouts are suspended until the company documentation is complete." };
  const ref = `comm:${id}`, now = Date.now(), amt = money(c.amount_usdt);
  let res;
  try {
    res = await env.DB.batch([
      env.DB.prepare("INSERT INTO funding_ledger(kind,amount,ref,note,actor,created_at) SELECT 'commission_payout',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM referral_commissions WHERE id=? AND status='Pending') AND EXISTS(SELECT 1 FROM users WHERE email=? AND is_banned=0) AND (SELECT COALESCE(SUM(amount),0) FROM funding_ledger)>=?").bind(-amt, ref, `${c.referrer_email} ← ${c.referred_email}`, actor, now, id, c.referrer_email, amt),
      env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) SELECT ?,'Referral Commission',?,'Approved',?,? WHERE EXISTS(SELECT 1 FROM funding_ledger WHERE ref=?)").bind(c.referrer_email, amt, `Direct referral commission #${id} (${c.percent}%)`, now, ref),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt+?,2) WHERE email=? AND EXISTS(SELECT 1 FROM funding_ledger WHERE ref=?)").bind(amt, c.referrer_email, ref),
      env.DB.prepare("UPDATE referral_commissions SET status='Approved',decided_by=?,decided_at=?,note=? WHERE id=? AND status='Pending' AND EXISTS(SELECT 1 FROM funding_ledger WHERE ref=?)").bind(actor, now, note, id, ref)
    ]);
  } catch { return { ok: false, code: "duplicate", message: "This commission was already paid." }; }
  if (!res[0].meta?.changes) return { ok: false, code: "pending", message: "The payout fund is insufficient, so the commission stays pending." };
  await notify(env.DB, c.referrer_email, "Referral commission credited", `${amt.toFixed(2)} USDT referral commission was added to your balance.`);
  return { ok: true, message: "Commission approved and credited." };
}
async function commissionAction(b, adminEmail, env) {
  const id = Number(b.id), decision = b.decision === "Approved" ? "Approved" : b.decision === "Rejected" ? "Rejected" : "", note = String(b.note || "").trim().slice(0, 300);
  if (!id || !decision) return out({ ok: false, message: "Invalid decision." }, 400);
  if (decision === "Rejected") {
    if (note.length < 3) return out({ ok: false, message: "A reason is required to reject a commission." }, 400);
    const c = await env.DB.prepare("SELECT referrer_email FROM referral_commissions WHERE id=? AND status='Pending'").bind(id).first();
    if (!c) return out({ ok: false, message: "Pending commission not found." }, 404);
    await env.DB.batch([env.DB.prepare("UPDATE referral_commissions SET status='Rejected',decided_by=?,decided_at=?,note=? WHERE id=? AND status='Pending'").bind(adminEmail, Date.now(), note, id), auditStmt(env.DB, adminEmail, "commission.rejected", c.referrer_email, { id }, note)]);
    return out({ ok: true, message: "Commission rejected." });
  }
  const r = await payCommission(env, id, adminEmail, note);
  if (r.ok) await audit(env.DB, adminEmail, "commission.approved", String(id), {}, note);
  return out({ ok: r.ok, message: r.message }, r.ok ? 200 : 409);
}
async function adminCommissions(url, env) {
  const status = ["Pending", "Approved", "Rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "";
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60).replace(/[%_]/g, ""); const like = `%${q}%`;
  const r = await env.DB.prepare("SELECT c.id,c.referrer_email,c.referred_email,c.purchase_id,c.base_usdt,c.percent,c.amount_usdt,c.status,c.note,c.created_at,p.plan_title,p.kind FROM referral_commissions c LEFT JOIN vip_purchases p ON p.id=c.purchase_id WHERE (?='' OR c.status=?) AND (?='' OR c.referrer_email LIKE ? OR c.referred_email LIKE ?) ORDER BY c.id DESC LIMIT 100").bind(status, status, q, like, like).all();
  return out({ ok: true, commissions: r.results || [] });
}

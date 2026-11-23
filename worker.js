const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PROOF_BYTES = 3 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await initDb(env.DB, env.PRIMARY_ADMIN_EMAIL || "");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });

      if (url.pathname === "/api/auth" && request.method === "POST") return await authRoute(request, env);
      if (url.pathname === "/api/user" && request.method === "GET") {
        const session = await requireSession(request, env.DB);
        if (session.error) return json({ ok: false, message: session.error }, 401, request, env);
        return await userData(session.user, env);
      }
      if (url.pathname === "/api/public-settings" && request.method === "GET") return json({ ok: true, settings: await getSettings(env.DB) }, 200, request, env);
      if (url.pathname === "/api/plans" && request.method === "GET") return json({ ok: true, plans: await getPlans(env.DB) }, 200, request, env);
      if (url.pathname.startsWith("/media/") && request.method === "GET") return await getPublicMedia(url, env);
      if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

      if (url.pathname === "/api/logout" && request.method === "POST") {
        const token = bearer(request);
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
        return json({ ok: true, message: "Signed out." }, 200, request, env);
      }

      const session = await requireSession(request, env.DB);
      if (session.error) return json({ ok: false, message: session.error }, 401, request, env);
      const user = session.user;
      if (request.method === "POST" && url.pathname === "/api/deposit") return await createDepositRequest(request, user, env);
      if (request.method === "POST" && url.pathname === "/api/buy-vip") return await buyPlan(await request.json(), user, env);
      if (request.method === "POST" && url.pathname === "/api/checkin") return await checkin(user, env);
      if (request.method === "POST" && url.pathname === "/api/payment-method") return await savePaymentMethod(await request.json(), user, env);
      if (request.method === "POST" && url.pathname === "/api/security-pin") return await savePin(await request.json(), user, env);
      if (request.method === "POST" && url.pathname === "/api/withdraw") return await requestWithdrawal(await request.json(), user, env);

      if (url.pathname.startsWith("/api/admin/") && !(await isAdmin(user.email, env.DB))) return json({ ok: false, message: "Super Admin access required." }, 403, request, env);
      if (request.method === "GET" && url.pathname === "/api/admin/overview") return await adminOverview(env);
      if (request.method === "POST" && url.pathname === "/api/admin/settings") return await saveAdminSettings(await request.json(), env);
      if (request.method === "POST" && url.pathname === "/api/admin/upsert-plan") return await upsertPlan(await request.json(), env);
      if (request.method === "POST" && url.pathname === "/api/admin/delete-plan") return await deletePlan(await request.json(), env);
      if (request.method === "POST" && url.pathname === "/api/admin/add-super-admin") return await addSuperAdmin(await request.json(), user.email, env);
      if (request.method === "POST" && url.pathname === "/api/admin/remove-super-admin") return await removeSuperAdmin(await request.json(), user.email, env);
      if (request.method === "POST" && url.pathname === "/api/admin/deposit-action") return await decideDeposit(await request.json(), user.email, env);
      if (request.method === "POST" && url.pathname === "/api/admin/withdrawal-action") return await decideWithdrawal(await request.json(), user.email, env);
      if (request.method === "POST" && url.pathname === "/api/admin/banner") return await uploadBanner(request, env);
      if (request.method === "GET" && url.pathname.startsWith("/api/admin/deposit-proof/")) return await getDepositProof(url, env);
      if (url.pathname.startsWith("/api/")) return json({ ok: false, message: "API route not found." }, 404, request, env);
    } catch (error) {
      console.error("Request failed", error?.stack || error);
      return json({ ok: false, message: "A server error occurred. Please try again." }, 500, request, env);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.APP_ORIGIN || origin;
  return { ...JSON_HEADERS, "Access-Control-Allow-Origin": allowed || "*", "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
function json(data, status, request, env) { return new Response(JSON.stringify(data), { status, headers: corsHeaders(request, env) }); }
function bearer(request) { return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim(); }
async function sha256(value) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function hashPassword(password) {
  const iterations = 210000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
  return `pbkdf2$${iterations}$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  if (String(stored || "").startsWith("pbkdf2$")) {
    const [, iter, saltHex, hashHex] = stored.split("$");
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map(x => parseInt(x, 16)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iter), hash: "SHA-256" }, key, 256);
    const actual = [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
    return actual === hashHex;
  }
  return stored === await sha256(`${password}::pdf_usdt_salt`);
}
function money(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function cleanEmail(v) { return String(v || "").trim().toLowerCase(); }

async function initDb(db, primaryAdmin) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, custom_id TEXT UNIQUE NOT NULL, fullname TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, referral_code TEXT, password_hash TEXT NOT NULL, balance_usdt REAL NOT NULL DEFAULT 0, vip_level INTEGER NOT NULL DEFAULT 0, vip_expires_at INTEGER DEFAULT 0, wallet_address TEXT DEFAULT '', wallet_network TEXT DEFAULT 'TRC20', withdraw_pin TEXT DEFAULT '', last_checkin_ms INTEGER DEFAULT 0, checkin_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, type TEXT NOT NULL, amount_usdt REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Pending', details TEXT DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_plans (vip_level INTEGER PRIMARY KEY, title TEXT NOT NULL, price_usdt REAL NOT NULL, daily_usdt REAL NOT NULL DEFAULT 0, duration_days INTEGER NOT NULL DEFAULT 30, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS super_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL DEFAULT 'SUPER_ADMIN', added_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS deposit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, amount_usdt REAL NOT NULL, network TEXT NOT NULL, tx_reference TEXT DEFAULT '', proof_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', admin_note TEXT DEFAULT '', credited_at TEXT DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS deposit_tx_reference_unique ON deposit_requests(tx_reference) WHERE tx_reference <> ''`),
    db.prepare(`INSERT OR IGNORE INTO vip_plans (vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES (1,'VIP 1',10,1,30,?)`).bind(Date.now()),
    db.prepare(`INSERT OR IGNORE INTO vip_plans (vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES (2,'VIP 2',25,2.6,30,?)`).bind(Date.now()),
    db.prepare(`INSERT OR IGNORE INTO vip_plans (vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES (3,'VIP 3',60,6.5,30,?)`).bind(Date.now())
  ]);
  if (primaryAdmin) await db.prepare("INSERT OR IGNORE INTO super_admins (email,role,added_by,created_at) VALUES (?,'SUPER_ADMIN','SYSTEM',?)").bind(cleanEmail(primaryAdmin), Date.now()).run();
  const defaults = {
    company_name: "Prime Digital Finance", brand_short: "PDF", tagline: "Digital Finance • Transparency • Control",
    hero_title: "Welcome to Prime Digital Finance", hero_subtitle: "Explore your account dashboard and platform services.",
    banner_key: "", deposit_address: "", deposit_network: "TRC20", deposit_instructions: "Send only the selected USDT network. Confirm the address carefully before sending.",
    deposit_min: "1", deposit_max: "5000", withdraw_min: "2", checkin_reward: "0.20", telegram_url: "", whatsapp_url: "", live_chat_url: "", announcement: "Welcome to Prime Digital Finance.",
    faq_text: "Contact support if you need help with a payment or account."
  };
  for (const [k,v] of Object.entries(defaults)) await db.prepare("INSERT OR IGNORE INTO site_settings (setting_key,setting_value,updated_at) VALUES (?,?,?)").bind(k,v,Date.now()).run();
}

async function requireSession(request, db) {
  const token = bearer(request);
  if (!token) return { error: "Please sign in again." };
  const tokenHash = await sha256(token);
  const row = await db.prepare(`SELECT s.user_email, u.custom_id, u.fullname, u.email, u.phone, u.referral_code, u.balance_usdt, u.vip_level, u.vip_expires_at, u.wallet_address, u.wallet_network, u.last_checkin_ms, u.checkin_count, u.created_at FROM sessions s JOIN users u ON u.email=s.user_email WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash,Date.now()).first();
  if (!row) return { error: "Your session has expired. Please sign in again." };
  row.is_super_admin = await isAdmin(row.email, db);
  const pin = await db.prepare("SELECT withdraw_pin FROM users WHERE email=?").bind(row.email).first();
  row.has_pin = Boolean(pin?.withdraw_pin);
  return { user: row };
}
async function isAdmin(email, db) { return Boolean(await db.prepare("SELECT id FROM super_admins WHERE email=?").bind(cleanEmail(email)).first()); }
async function authRoute(request, env) {
  const body = await request.json(); const email = cleanEmail(body.email); const password = String(body.password || "");
  if (!email || password.length < 8) return json({ok:false,message:"Enter a valid email and a password of at least 8 characters."},400,request,env);
  if (body.mode === "register") {
    const name = String(body.fullname || "").trim();
    if (!name) return json({ok:false,message:"Full name is required."},400,request,env);
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (existing) return json({ok:false,message:"An account with this email already exists."},409,request,env);
    let customId; do { customId = "PDF" + crypto.getRandomValues(new Uint32Array(1))[0].toString().slice(0,6).padStart(6,"0"); } while (await env.DB.prepare("SELECT id FROM users WHERE custom_id=?").bind(customId).first());
    await env.DB.prepare(`INSERT INTO users (custom_id,fullname,email,phone,referral_code,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`).bind(customId,name,email,String(body.phone||""),String(body.referral||""),await hashPassword(password),Date.now()).run();
    return json({ok:true,message:"Account created. Please sign in."},200,request,env);
  }
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email=?").bind(email).first();
  if (!row || !(await verifyPassword(password, row.password_hash))) return json({ok:false,message:"Invalid email or password."},401,request,env);
  if (!String(row.password_hash).startsWith("pbkdf2$")) await env.DB.prepare("UPDATE users SET password_hash=? WHERE email=?").bind(await hashPassword(password),email).run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_email,expires_at,created_at) VALUES (?,?,?,?)").bind(await sha256(token),email,Date.now()+SESSION_TTL_MS,Date.now()).run();
  return json({ok:true,message:"Welcome back.",token},200,request,env);
}
async function getPlans(db) { const r=await db.prepare("SELECT vip_level,title,price_usdt,daily_usdt,duration_days FROM vip_plans ORDER BY vip_level").all(); return r.results||[]; }
async function getSettings(db) { const r=await db.prepare("SELECT setting_key,setting_value FROM site_settings").all(); return Object.fromEntries((r.results||[]).map(x=>[x.setting_key,x.setting_value])); }
async function userData(user, env) {
  const [tx,team]=await Promise.all([
    env.DB.prepare("SELECT id,type,amount_usdt,status,details,created_at FROM transactions WHERE user_email=? ORDER BY id DESC LIMIT 100").bind(user.email).all(),
    env.DB.prepare("SELECT custom_id,fullname,created_at,vip_level FROM users WHERE referral_code=? ORDER BY id DESC LIMIT 100").bind(user.custom_id).all()
  ]);
  const members=team.results||[];
  return new Response(JSON.stringify({ok:true,user,plans:await getPlans(env.DB),transactions:tx.results||[],settings:await getSettings(env.DB),team:{members,total:members.length,active:members.filter(m=>Number(m.vip_level)>0).length,earnings:0}}),{headers:JSON_HEADERS});
}
async function createDepositRequest(request,user,env) {
  if (!env.UPLOADS) return json({ok:false,message:"File storage is not configured. Admin must finish the R2 setup."},503,request,env);
  const form=await request.formData(); const amount=money(form.get("amount")); const network=String(form.get("network")||"").trim(); const txRef=String(form.get("tx_reference")||"").trim(); const file=form.get("proof"); const cfg=await getSettings(env.DB);
  if (!Number.isFinite(amount)||amount<=0||amount<Number(cfg.deposit_min||1)||amount>Number(cfg.deposit_max||5000)) return json({ok:false,message:`Deposit must be between ${cfg.deposit_min} and ${cfg.deposit_max} USDT.`},400,request,env);
  if (network !== String(cfg.deposit_network || "TRC20")) return json({ok:false,message:"The selected deposit network does not match the administrator's configured network."},400,request,env);
  if (!cfg.deposit_address) return json({ok:false,message:"Deposit instructions are not available yet. Please contact support."},400,request,env);
  if (!file || typeof file.arrayBuffer!=="function" || file.size>MAX_PROOF_BYTES || !["image/jpeg","image/png","image/webp"].includes(file.type)) return json({ok:false,message:"Upload a JPG, PNG or WEBP payment screenshot up to 3 MB."},400,request,env);
  if (txRef && await env.DB.prepare("SELECT id FROM deposit_requests WHERE tx_reference=?").bind(txRef).first()) return json({ok:false,message:"This transaction reference has already been submitted."},409,request,env);
  const key=`deposit-proofs/${user.custom_id}/${Date.now()}-${crypto.randomUUID()}.${file.type.split("/")[1]}`;
  await env.UPLOADS.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{userEmail:user.email}});
  const res=await env.DB.prepare(`INSERT INTO deposit_requests (user_email,amount_usdt,network,tx_reference,proof_key,status,created_at) VALUES (?,?,?,?,?,'Pending',?)`).bind(user.email,amount,network,txRef,key,Date.now()).run();
  await env.DB.prepare(`INSERT INTO transactions (user_email,type,amount_usdt,status,details,created_at) VALUES (?,'USDT Deposit',?,'Pending',?,?)`).bind(user.email,amount,`Awaiting admin review • ${network} • Deposit request #${res.meta.last_row_id}`,Date.now()).run();
  return json({ok:true,message:"Deposit request submitted. Your balance will update only after admin approval."},200,request,env);
}
async function decideDeposit(body,adminEmail,env) {
  const id=Number(body.requestId); const decision=body.decision==="Approved"?"Approved":body.decision==="Rejected"?"Rejected":""; const note=String(body.note||"").slice(0,500);
  if(!id||!decision) return Response.json({ok:false,message:"Invalid deposit decision."},{status:400});
  const dep=await env.DB.prepare("SELECT * FROM deposit_requests WHERE id=?").bind(id).first();
  if(!dep) return Response.json({ok:false,message:"Deposit request not found."},{status:404});
  if(dep.status!=="Pending") return Response.json({ok:false,message:"This request has already been reviewed."},{status:409});
  const token=crypto.randomUUID(); const now=Date.now();
  if(decision==="Approved") {
    await env.DB.batch([
      env.DB.prepare("UPDATE deposit_requests SET status='Approved',admin_note=?,credited_at=?,reviewed_at=? WHERE id=? AND status='Pending'").bind(note,token,now,id),
      env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt + ?,2) WHERE email=? AND EXISTS (SELECT 1 FROM deposit_requests WHERE id=? AND status='Approved' AND credited_at=?)").bind(dep.amount_usdt,dep.user_email,id,token),
      env.DB.prepare("UPDATE transactions SET status='Approved',details=details || ? WHERE user_email=? AND type='USDT Deposit' AND status='Pending' AND details LIKE ?").bind(` • Approved by ${adminEmail}`,dep.user_email,`%Deposit request #${id}`)
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE deposit_requests SET status='Rejected',admin_note=?,reviewed_at=? WHERE id=? AND status='Pending'").bind(note,now,id),
      env.DB.prepare("UPDATE transactions SET status='Rejected',details=details || ? WHERE user_email=? AND type='USDT Deposit' AND status='Pending' AND details LIKE ?").bind(` • Rejected: ${note||'Not approved'}`,dep.user_email,`%Deposit request #${id}`)
    ]);
  }
  return Response.json({ok:true,message:decision==="Approved"?"Deposit approved and member balance credited.":"Deposit rejected. No balance was credited."});
}
async function getDepositProof(url,env) {
  const id=Number(url.pathname.split("/").pop()); const dep=await env.DB.prepare("SELECT proof_key FROM deposit_requests WHERE id=?").bind(id).first();
  if(!dep) return new Response("Not found",{status:404}); const obj=await env.UPLOADS.get(dep.proof_key); if(!obj) return new Response("File not found",{status:404});
  const h=new Headers(); obj.writeHttpMetadata(h); h.set("Cache-Control","private, no-store"); return new Response(obj.body,{headers:h});
}
async function uploadBanner(request,env) {
  if(!env.UPLOADS) return Response.json({ok:false,message:"R2 file storage is not configured."},{status:503});
  const form=await request.formData(); const file=form.get("banner");
  if(!file||typeof file.arrayBuffer!=="function"||file.size>5*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)) return Response.json({ok:false,message:"Upload a JPG, PNG or WEBP banner up to 5 MB."},{status:400});
  const key=`banners/${Date.now()}-${crypto.randomUUID()}.${file.type.split("/")[1]}`; await env.UPLOADS.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type}});
  await env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES('banner_key',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at").bind(key,Date.now()).run();
  return Response.json({ok:true,message:"Home banner updated."});
}
async function getPublicMedia(url,env) {
  const key=decodeURIComponent(url.pathname.slice("/media/".length)); if(!key.startsWith("banners/")) return new Response("Not found",{status:404});
  const obj=await env.UPLOADS?.get(key); if(!obj) return new Response("Not found",{status:404}); const h=new Headers(); obj.writeHttpMetadata(h); h.set("Cache-Control","public, max-age=300"); return new Response(obj.body,{headers:h});
}
async function adminOverview(env) {
  const [plans,admins,deposits,withdrawals,users,settings]=await Promise.all([
    getPlans(env.DB),env.DB.prepare("SELECT email,role,added_by,created_at FROM super_admins ORDER BY id").all(),
    env.DB.prepare("SELECT id,user_email,amount_usdt,network,tx_reference,status,admin_note,created_at FROM deposit_requests WHERE status='Pending' ORDER BY id DESC LIMIT 100").all(),
    env.DB.prepare("SELECT id,user_email,amount_usdt,status,details,created_at FROM transactions WHERE type='USDT Withdrawal' AND status='Pending' ORDER BY id DESC LIMIT 100").all(),
    env.DB.prepare("SELECT custom_id,fullname,email,balance_usdt,vip_level,created_at FROM users ORDER BY id DESC LIMIT 100").all(),getSettings(env.DB)
  ]);
  return Response.json({ok:true,plans,super_admins:admins.results||[],pending_deposits:deposits.results||[],pending_withdrawals:withdrawals.results||[],recent_users:users.results||[],settings});
}
async function saveAdminSettings(body,env) {
  const allowed=["company_name","brand_short","tagline","hero_title","hero_subtitle","deposit_address","deposit_network","deposit_instructions","deposit_min","deposit_max","withdraw_min","checkin_reward","telegram_url","whatsapp_url","live_chat_url","announcement","faq_text"];
  if (body.deposit_network !== undefined && !["TRC20","BEP20","ERC20"].includes(String(body.deposit_network))) return Response.json({ok:false,message:"Choose TRC20, BEP20 or ERC20."},{status:400});
  for (const key of ["deposit_min","deposit_max","withdraw_min"]) { if (body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) <= 0)) return Response.json({ok:false,message:`${key} must be greater than zero.`},{status:400}); }
  if (body.checkin_reward !== undefined && (!Number.isFinite(Number(body.checkin_reward)) || Number(body.checkin_reward) < 0)) return Response.json({ok:false,message:"Check-in reward cannot be negative."},{status:400});
  const current=await getSettings(env.DB);
  const min=Number(body.deposit_min ?? current.deposit_min ?? 1), max=Number(body.deposit_max ?? current.deposit_max ?? 5000);
  if(min>max) return Response.json({ok:false,message:"Minimum deposit cannot be higher than maximum deposit."},{status:400});
  for (const key of ["telegram_url","whatsapp_url","live_chat_url"]) { const value=body[key]; if(value && !/^https:\/\//i.test(String(value))) return Response.json({ok:false,message:`${key} must start with https://`},{status:400}); }
  for(const key of allowed) if(body[key]!==undefined) await env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at").bind(key,String(body[key]).slice(0,3000),Date.now()).run();
  return Response.json({ok:true,message:"Website settings saved."});
}
async function upsertPlan(b,env) {
  const level=Number(b.vip_level),price=money(b.price_usdt),daily=money(b.daily_usdt),days=Number(b.duration_days),title=String(b.title||`Product ${level}`).trim();
  if(!Number.isInteger(level)||level<1||!title||price<=0||daily<0||!Number.isInteger(days)||days<1) return Response.json({ok:false,message:"Enter valid product details."},{status:400});
  await env.DB.prepare(`INSERT INTO vip_plans(vip_level,title,price_usdt,daily_usdt,duration_days,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(vip_level) DO UPDATE SET title=excluded.title,price_usdt=excluded.price_usdt,daily_usdt=excluded.daily_usdt,duration_days=excluded.duration_days,updated_at=excluded.updated_at`).bind(level,title,price,daily,days,Date.now()).run();
  return Response.json({ok:true,message:"Product saved."});
}
async function deletePlan(b,env) { const level=Number(b.vip_level); await env.DB.prepare("DELETE FROM vip_plans WHERE vip_level=?").bind(level).run(); return Response.json({ok:true,message:"Product removed."}); }
async function addSuperAdmin(b,adminEmail,env) { const email=cleanEmail(b.newAdminEmail); if(!email.includes("@")) return Response.json({ok:false,message:"Enter a valid admin email."},{status:400}); await env.DB.prepare("INSERT OR IGNORE INTO super_admins(email,role,added_by,created_at) VALUES(?,'SUPER_ADMIN',?,?)").bind(email,adminEmail,Date.now()).run(); return Response.json({ok:true,message:"Admin added."}); }
async function removeSuperAdmin(b,adminEmail,env) { const email=cleanEmail(b.email); if(!email||email===cleanEmail(env.PRIMARY_ADMIN_EMAIL)||email===cleanEmail(adminEmail)) return Response.json({ok:false,message:"The primary owner and your current admin account cannot be removed here."},{status:400}); await env.DB.prepare("DELETE FROM super_admins WHERE email=?").bind(email).run(); return Response.json({ok:true,message:"Admin access removed."}); }
async function decideWithdrawal(b,adminEmail,env) {
  const id=Number(b.txId),decision=b.decision==="Approved"?"Approved":b.decision==="Rejected"?"Rejected":""; if(!id||!decision) return Response.json({ok:false,message:"Invalid withdrawal decision."},{status:400});
  const tx=await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND type='USDT Withdrawal'").bind(id).first(); if(!tx||tx.status!=="Pending") return Response.json({ok:false,message:"Pending withdrawal not found."},{status:404});
  if(decision==="Rejected") {
    const refundToken=crypto.randomUUID();
    await env.DB.batch([env.DB.prepare("UPDATE transactions SET status='Rejected',details=details || ? WHERE id=? AND status='Pending'").bind(` • Rejected by ${adminEmail} [${refundToken}]`,id),env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt + ?,2) WHERE email=? AND EXISTS(SELECT 1 FROM transactions WHERE id=? AND status='Rejected' AND details LIKE ?)").bind(tx.amount_usdt,tx.user_email,id,`%${refundToken}%`)]);
  } else await env.DB.prepare("UPDATE transactions SET status='Approved',details=details || ? WHERE id=? AND status='Pending'").bind(` • Approved by ${adminEmail}`,id).run();
  return Response.json({ok:true,message:`Withdrawal ${decision.toLowerCase()}.`});
}
async function savePaymentMethod(b,user,env) { const addr=String(b.wallet_address||"").trim(),net=String(b.wallet_network||"").trim(); if(addr.length<10||!['TRC20','BEP20','ERC20'].includes(net)) return Response.json({ok:false,message:"Enter a valid wallet address and supported network."},{status:400}); await env.DB.prepare("UPDATE users SET wallet_address=?,wallet_network=? WHERE email=?").bind(addr,net,user.email).run(); return Response.json({ok:true,message:"Withdrawal wallet saved."}); }
async function savePin(b,user,env) { const pin=String(b.pin||""); if(!/^\d{4,8}$/.test(pin)) return Response.json({ok:false,message:"PIN must contain 4 to 8 digits."},{status:400}); await env.DB.prepare("UPDATE users SET withdraw_pin=? WHERE email=?").bind(await hashPassword(pin),user.email).run(); return Response.json({ok:true,message:"Transaction PIN saved securely."}); }
async function requestWithdrawal(b,user,env) {
  const amount=money(b.amount),pin=String(b.pin||""); const cfg=await getSettings(env.DB); const record=await env.DB.prepare("SELECT balance_usdt,wallet_address,wallet_network,withdraw_pin FROM users WHERE email=?").bind(user.email).first();
  if(!record.wallet_address) return Response.json({ok:false,message:"Save your withdrawal wallet first."},{status:400});
  if(!record.withdraw_pin||!(await verifyPassword(pin,record.withdraw_pin))) return Response.json({ok:false,message:"Incorrect transaction PIN."},{status:401});
  if(amount<Number(cfg.withdraw_min||2)||amount>Number(record.balance_usdt||0)) return Response.json({ok:false,message:`Withdrawal minimum is ${cfg.withdraw_min||2} USDT and cannot exceed your available balance.`},{status:400});
  const changed=await env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt-?,2) WHERE email=? AND balance_usdt>=?").bind(amount,user.email,amount).run(); if(!changed.meta?.changes) return Response.json({ok:false,message:"Insufficient balance."},{status:400});
  await env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) VALUES(?,'USDT Withdrawal',?,'Pending',?,?)").bind(user.email,amount,`Reserved for ${record.wallet_network}: ${record.wallet_address}`,Date.now()).run();
  return Response.json({ok:true,message:"Withdrawal request submitted for admin review."});
}
async function buyPlan(b,user,env) { const p=await env.DB.prepare("SELECT * FROM vip_plans WHERE vip_level=?").bind(Number(b.vip)).first(); if(!p) return Response.json({ok:false,message:"Product not found."},{status:404}); const u=await env.DB.prepare("SELECT balance_usdt,vip_level FROM users WHERE email=?").bind(user.email).first(); if(Number(p.vip_level)<=Number(u.vip_level)) return Response.json({ok:false,message:"Choose a higher product level."},{status:400}); if(Number(u.balance_usdt)<Number(p.price_usdt)) return Response.json({ok:false,message:"Insufficient balance."},{status:400}); const expires=Date.now()+Number(p.duration_days)*86400000; await env.DB.batch([env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt-?,2),vip_level=?,vip_expires_at=? WHERE email=? AND balance_usdt>=?").bind(p.price_usdt,p.vip_level,expires,user.email,p.price_usdt),env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) VALUES(?,?,?,'Approved',?,?)").bind(user.email,`${p.title} Purchase`,p.price_usdt,"Product purchase",Date.now())]); return Response.json({ok:true,message:`${p.title} activated.`}); }
async function checkin(user,env) { const u=await env.DB.prepare("SELECT last_checkin_ms,balance_usdt,checkin_count FROM users WHERE email=?").bind(user.email).first(); if(u.last_checkin_ms&&Date.now()-u.last_checkin_ms<86400000) return Response.json({ok:false,message:"Daily check-in is not available yet."},{status:400}); const cfg=await getSettings(env.DB); const reward=Number(cfg.checkin_reward||0),now=Date.now(); if(reward<=0) return Response.json({ok:false,message:"Daily check-in is currently disabled."},{status:400}); await env.DB.batch([env.DB.prepare("UPDATE users SET balance_usdt=ROUND(balance_usdt+?,2),last_checkin_ms=?,checkin_count=checkin_count+1 WHERE email=?").bind(reward,now,user.email),env.DB.prepare("INSERT INTO transactions(user_email,type,amount_usdt,status,details,created_at) VALUES(?,'Daily Check-in',?,'Approved','Daily check-in credit',?)").bind(user.email,reward,now)]); return Response.json({ok:true,message:"Check-in recorded."}); }

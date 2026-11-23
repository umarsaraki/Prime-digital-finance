export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    await initDatabase(env.DB);

    try {
      if (url.pathname === "/api/auth" && request.method === "POST") {
        const body = await request.json();
        return await handleAuth(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/user" && request.method === "GET") {
        const email = (url.searchParams.get("email") || "").toLowerCase().trim();
        return await getUserData(email, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/plans" && request.method === "GET") {
        return await handleGetPlans(env.DB, corsHeaders);
      }

      if (url.pathname === "/api/checkin" && request.method === "POST") {
        const body = await request.json();
        return await handleCheckin(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/buy-vip" && request.method === "POST") {
        const body = await request.json();
        return await handleBuyVip(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/deposit" && request.method === "POST") {
        const body = await request.json();
        return await handleDeposit(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/payment-method" && request.method === "POST") {
        const body = await request.json();
        return await handleSavePaymentMethod(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/security-pin" && request.method === "POST") {
        const body = await request.json();
        return await handleSavePin(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/withdraw" && request.method === "POST") {
        const body = await request.json();
        return await handleWithdraw(body, env, corsHeaders);
      }

      if (url.pathname === "/api/admin/overview" && request.method === "GET") {
        const adminEmail = (url.searchParams.get("adminEmail") || "").toLowerCase().trim();
        return await handleAdminOverview(adminEmail, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/admin/settings" && request.method === "POST") {
        const body = await request.json();
        return await handleAdminSettings(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/admin/add-super-admin" && request.method === "POST") {
        const body = await request.json();
        return await handleAddSuperAdmin(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/admin/upsert-plan" && request.method === "POST") {
        const body = await request.json();
        return await handleUpsertPlan(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/admin/delete-plan" && request.method === "POST") {
        const body = await request.json();
        return await handleDeletePlan(body, env.DB, corsHeaders);
      }

      if (url.pathname === "/api/admin/withdrawal-action" && request.method === "POST") {
        const body = await request.json();
        return await handleWithdrawalAction(body, env.DB, corsHeaders);
      }

      if (request.method === "GET") {
        return new Response(getHtmlApp(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=UTF-8" }
        });
      }

      return new Response(JSON.stringify({ ok: false, message: "Service ready." }), {
        status: 200,
        headers: corsHeaders
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, message: "Unable to process request right now. Please try again." }),
        { status: 500, headers: corsHeaders }
      );
    }
  }
};
const PRIMARY_ADMIN_EMAIL = "umarsaraki96@gmail.com";

async function initDatabase(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        custom_id TEXT UNIQUE NOT NULL,
        fullname TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        referral_code TEXT,
        password_hash TEXT NOT NULL,
        balance_usdt REAL NOT NULL DEFAULT 0,
        vip_level INTEGER NOT NULL DEFAULT 0,
        vip_expires_at INTEGER DEFAULT 0,
        wallet_address TEXT DEFAULT '',
        wallet_network TEXT DEFAULT 'TRC20',
        withdraw_pin TEXT DEFAULT '',
        last_checkin_ms INTEGER DEFAULT 0,
        checkin_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        type TEXT NOT NULL,
        amount_usdt REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Pending',
        details TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS vip_plans (
        vip_level INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        price_usdt REAL NOT NULL,
        daily_usdt REAL NOT NULL,
        duration_days INTEGER NOT NULL DEFAULT 30,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        telegram_chat_ids TEXT DEFAULT '7544805601,8552397401',
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS super_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
        added_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      INSERT OR IGNORE INTO admin_settings (id, telegram_chat_ids, updated_at)
      VALUES (1, '7544805601,8552397401', ?)
    `).bind(Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO super_admins (email, role, added_by, created_at)
      VALUES (?, 'SUPER_ADMIN', 'SYSTEM', ?)
    `).bind(PRIMARY_ADMIN_EMAIL, Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
      VALUES (1, 'VIP 1', 10, 1.0, 30, ?)
    `).bind(Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
      VALUES (2, 'VIP 2', 25, 2.6, 30, ?)
    `).bind(Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
      VALUES (3, 'VIP 3', 60, 6.5, 30, ?)
    `).bind(Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
      VALUES (4, 'VIP 4', 120, 13.5, 45, ?)
    `).bind(Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
      VALUES (5, 'VIP 5', 250, 29.0, 60, ?)
    `).bind(Date.now()),
    db.prepare(`
      INSERT OR IGNORE INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
      VALUES (6, 'VIP 6', 500, 60.0, 90, ?)
    `).bind(Date.now())
  ]);
}

async function isAuthorizedSuperAdmin(email, db) {
  const cleanEmail = (email || "").toLowerCase().trim();
  if (!cleanEmail) return false;
  if (cleanEmail === PRIMARY_ADMIN_EMAIL) return true;
  const row = await db.prepare("SELECT id FROM super_admins WHERE email = ?").bind(cleanEmail).first();
  return Boolean(row);
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "::pdf_usdt_salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateCustomId() {
  return "PDF" + Math.floor(100000 + Math.random() * 900000);
}

async function logTransaction(db, email, type, amountUsdt, status, details) {
  await db
    .prepare(
      `INSERT INTO transactions (user_email, type, amount_usdt, status, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(email, type, Number(amountUsdt.toFixed(2)), status, details, Date.now())
    .run();
}

async function handleGetPlans(db, headers) {
  const rows = await db
    .prepare("SELECT vip_level, title, price_usdt, daily_usdt, duration_days, updated_at FROM vip_plans ORDER BY vip_level ASC")
    .all();
  return new Response(JSON.stringify({ ok: true, plans: rows.results || [] }), { headers });
}

async function handleAuth(body, db, headers) {
  const mode = body.mode;
  const email = (body.email || "").toLowerCase().trim();
  const password = body.password || "";

  if (!email || !password) {
    return new Response(JSON.stringify({ ok: false, message: "Please provide email and password." }), {
      status: 400,
      headers
    });
  }

  const pwdHash = await hashPassword(password);

  if (mode === "register") {
    const fullname = (body.fullname || "").trim();
    const phone = (body.phone || "").trim();
    const referral = (body.referral || "").trim();

    if (!fullname) {
      return new Response(JSON.stringify({ ok: false, message: "Full name is required." }), {
        status: 400,
        headers
      });
    }

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
      return new Response(JSON.stringify({ ok: false, message: "An account with this email already exists." }), {
        status: 409,
        headers
      });
    }

    let customId = generateCustomId();
    const idCheck = await db.prepare("SELECT id FROM users WHERE custom_id = ?").bind(customId).first();
    if (idCheck) customId = "PDF" + Math.floor(100000 + Math.random() * 900000);

    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO users (custom_id, fullname, email, phone, referral_code, password_hash, balance_usdt, vip_level, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`
      )
      .bind(customId, fullname, email, phone, referral, pwdHash, now)
      .run();

    await logTransaction(db, email, "VIP 0 Welcome Bonus", 0, "Approved", "3-Day Free VIP 0 Welcome Package Activated");

    return new Response(JSON.stringify({ ok: true, message: "Account created! VIP 0 bonus is active.", email }), {
      headers
    });
  }

  const user = await db
    .prepare("SELECT email, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first();

  if (!user || user.password_hash !== pwdHash) {
    return new Response(JSON.stringify({ ok: false, message: "Invalid email or password." }), {
      status: 401,
      headers
    });
  }

  return new Response(JSON.stringify({ ok: true, message: "Welcome back!", email }), { headers });
}

async function getUserData(email, db, headers) {
  if (!email) {
    return new Response(JSON.stringify({ ok: false, message: "Missing user session." }), {
      status: 400,
      headers
    });
  }
const user = await db
    .prepare(
      `SELECT custom_id, fullname, email, phone, referral_code, balance_usdt, vip_level, vip_expires_at,
              wallet_address, wallet_network, withdraw_pin, last_checkin_ms, checkin_count, created_at
       FROM users WHERE email = ?`
    )
    .bind(email)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ ok: false, message: "User record not found." }), {
      status: 404,
      headers
    });
  }

  const plansRows = await db
    .prepare("SELECT vip_level, title, price_usdt, daily_usdt, duration_days, updated_at FROM vip_plans ORDER BY vip_level ASC")
    .all();

  const txRows = await db
    .prepare("SELECT id, type, amount_usdt, status, details, created_at FROM transactions WHERE user_email = ? ORDER BY id DESC LIMIT 50")
    .bind(email)
    .all();

  const isAdmin = await isAuthorizedSuperAdmin(email, db);

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        ...user,
        has_pin: Boolean(user.withdraw_pin),
        is_super_admin: isAdmin
      },
      plans: plansRows.results || [],
      transactions: txRows.results || []
    }),
    { headers }
  );
}

async function handleCheckin(body, db, headers) {
  const email = (body.email || "").toLowerCase().trim();
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return new Response(JSON.stringify({ ok: false, message: "User not found." }), { status: 404, headers });

  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  if (user.last_checkin_ms && now - user.last_checkin_ms < twentyFourHours) {
    const hoursLeft = Math.ceil((twentyFourHours - (now - user.last_checkin_ms)) / (1000 * 60 * 60));
    return new Response(
      JSON.stringify({ ok: false, message: `Daily check-in already claimed. Available again in ${hoursLeft}h.` }),
      { status: 400, headers }
    );
  }

  const rewardUsdt = 0.2;
  const newBalance = Number((Number(user.balance_usdt || 0) + rewardUsdt).toFixed(2));
  const nextCount = ((Number(user.checkin_count || 0)) % 7) + 1;

  await db
    .prepare("UPDATE users SET balance_usdt = ?, last_checkin_ms = ?, checkin_count = ? WHERE email = ?")
    .bind(newBalance, now, nextCount, email)
    .run();

  await logTransaction(db, email, "Daily Check-in", rewardUsdt, "Approved", `Day ${nextCount} Attendance Reward (+0.20 USDT)`);

  return new Response(
    JSON.stringify({ ok: true, message: "Claimed +0.20 USDT daily check-in reward!", balance_usdt: newBalance }),
    { headers }
  );
}

async function handleBuyVip(body, db, headers) {
  const email = (body.email || "").toLowerCase().trim();
  const targetVip = Number(body.vip);

  const plan = await db
    .prepare("SELECT vip_level, title, price_usdt, daily_usdt, duration_days FROM vip_plans WHERE vip_level = ?")
    .bind(targetVip)
    .first();

  if (!plan) {
    return new Response(JSON.stringify({ ok: false, message: "Selected VIP plan does not exist." }), { status: 400, headers });
  }

  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return new Response(JSON.stringify({ ok: false, message: "User not found." }), { status: 404, headers });

  const currentVip = Number(user.vip_level || 0);
  if (targetVip <= currentVip) {
    return new Response(
      JSON.stringify({ ok: false, message: `You are currently on VIP ${currentVip}. Select a higher VIP level.` }),
      { status: 400, headers }
    );
  }

  let refundUsdt = 0;
  if (currentVip > 0) {
    const prevPlan = await db.prepare("SELECT price_usdt FROM vip_plans WHERE vip_level = ?").bind(currentVip).first();
    if (prevPlan) refundUsdt = Number((Number(prevPlan.price_usdt || 0) * 0.5).toFixed(2));
  }

  const planPrice = Number(plan.price_usdt || 0);
  const currentBalance = Number(user.balance_usdt || 0);
  if (currentBalance < planPrice) {
    await logTransaction(db, email, `${plan.title} Upgrade`, planPrice, "Rejected", "Insufficient USDT Balance");
    return new Response(
      JSON.stringify({ ok: false, message: `Insufficient USDT balance. You need ${planPrice.toFixed(2)} USDT.` }),
      { status: 400, headers }
    );
  }

  const updatedBalance = Number((currentBalance - planPrice + refundUsdt).toFixed(2));
  const durationDays = Math.max(1, Number(plan.duration_days || 30));
  const expiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;

  await db
    .prepare("UPDATE users SET balance_usdt = ?, vip_level = ?, vip_expires_at = ? WHERE email = ?")
    .bind(updatedBalance, targetVip, expiresAt, email)
    .run();

  if (refundUsdt > 0) {
    await logTransaction(db, email, `VIP ${currentVip} Refund`, refundUsdt, "Approved", "50% Upgrade Refund Credited");
  }
  await logTransaction(
    db,
    email,
    `${plan.title} Purchase`,
    planPrice,
    "Approved",
    `Activated ${plan.title} (${Number(plan.daily_usdt).toFixed(2)} USDT/day for ${durationDays} days)`
  );

  return new Response(
    JSON.stringify({
      ok: true,
      message: refundUsdt > 0
        ? `${plan.title} activated! ${refundUsdt.toFixed(2)} USDT refund credited.`
        : `${plan.title} activated for ${durationDays} days!`,
      balance_usdt: updatedBalance,
      vip_level: targetVip
    }),
    { headers }
  );
}

async function handleDeposit(body, db, headers) {
  const email = (body.email || "").toLowerCase().trim();
  const amount = Number(body.amount || 0);
  if (!email || amount <= 0) {
    return new Response(JSON.stringify({ ok: false, message: "Enter a valid USDT deposit amount." }), {
      status: 400,
      headers
    });
  }

  const user = await db.prepare("SELECT balance_usdt FROM users WHERE email = ?").bind(email).first();
  if (!user) return new Response(JSON.stringify({ ok: false, message: "User not found." }), { status: 404, headers });

  const newBalance = Number((Number(user.balance_usdt || 0) + amount).toFixed(2));
  await db.prepare("UPDATE users SET balance_usdt = ? WHERE email = ?").bind(newBalance, email).run();
  await logTransaction(db, email, "USDT Deposit", amount, "Approved", "Instant USDT Wallet Top-Up");

  return new Response(
    JSON.stringify({ ok: true, message: `+${amount.toFixed(2)} USDT added to your balance!`, balance_usdt: newBalance }),
    { headers }
  );
}

async function handleSavePaymentMethod(body, db, headers) {
  const email = (body.email || "").toLowerCase().trim();
  const walletAddress = (body.wallet_address || "").trim();
  const walletNetwork = (body.wallet_network || "TRC20").trim();

  if (!walletAddress || walletAddress.length < 10) {
    return new Response(JSON.stringify({ ok: false, message: "Please enter a valid USDT wallet address." }), {
      status: 400,
      headers
    });
  }

  await db
    .prepare("UPDATE users SET wallet_address = ?, wallet_network = ? WHERE email = ?")
    .bind(walletAddress, walletNetwork, email)
    .run();

  return new Response(JSON.stringify({ ok: true, message: "USDT withdrawal wallet saved securely." }), { headers });
}

async function handleSavePin(body, db, headers) {
  const email = (body.email || "").toLowerCase().trim();
  const pin = (body.pin || "").trim();

  if (!/^\d{4}$/.test(pin)) {
    return new Response(JSON.stringify({ ok: false, message: "Security PIN must be exactly 4 digits." }), {
      status: 400,
      headers
    });
  }

  await db.prepare("UPDATE users SET withdraw_pin = ? WHERE email = ?").bind(pin, email).run();
  return new Response(JSON.stringify({ ok: true, message: "4-digit security PIN saved." }), { headers });
}

async function handleWithdraw(body, env, headers) {
  const email = (body.email || "").toLowerCase().trim();
  const amount = Number(body.amount || 0);
  const pin = (body.pin || "").trim();

  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return new Response(JSON.stringify({ ok: false, message: "User not found." }), { status: 404, headers });

  if (!user.wallet_address) {
    return new Response(JSON.stringify({ ok: false, message: "Please save your USDT wallet address first." }), {
      status: 400,
      headers
    });
  }

  if (!user.withdraw_pin || user.withdraw_pin !== pin) {
    return new Response(JSON.stringify({ ok: false, message: "Invalid 4-digit security PIN." }), {
      status: 401,
      headers
    });
  }

  if (amount < 2) {
    return new Response(JSON.stringify({ ok: false, message: "Minimum withdrawal is 2.00 USDT." }), {
      status: 400,
      headers
    });
  }

  const currentBalance = Number(user.balance_usdt || 0);
  if (currentBalance < amount) {
    await logTransaction(db, email, "USDT Withdrawal", amount, "Rejected", "Insufficient USDT Balance");
    return new Response(JSON.stringify({ ok: false, message: "Insufficient USDT balance." }), {
      status: 400,
      headers
    });
  }

  const newBalance = Number((currentBalance - amount).toFixed(2));
  await db.prepare("UPDATE users SET balance_usdt = ? WHERE email = ?").bind(newBalance, email).run();
  const txInsert = await db
    .prepare(
      `INSERT INTO transactions (user_email, type, amount_usdt, status, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(email, "USDT Withdrawal", Number(amount.toFixed(2)), "Pending", `Sent to ${user.wallet_network}: ${user.wallet_address}`, Date.now())
    .run();

  const txId = txInsert.meta && txInsert.meta.last_row_id ? txInsert.meta.last_row_id : 0;
const settings = await db.prepare("SELECT telegram_chat_ids FROM admin_settings WHERE id = 1").first();
  const rawChatIds = (settings && settings.telegram_chat_ids) || env.TELEGRAM_CHAT_IDS || "";

  if (env.TELEGRAM_BOT_TOKEN && rawChatIds) {
    const chatIds = rawChatIds.split(",").map((s) => s.trim()).filter(Boolean);
    const msg =
      `🔔 *NEW USDT WITHDRAWAL REQUEST*\n` +
      `🧾 Tx ID: #${txId}\n` +
      `🆔 User ID: \`${user.custom_id}\`\n` +
      `👤 Name: ${user.fullname}\n` +
      `💵 Amount: *${amount.toFixed(2)} USDT*\n` +
      `🌐 Network: ${user.wallet_network}\n` +
      `👛 Wallet: \`${user.wallet_address}\``;

    for (const chatId of chatIds) {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: "Markdown"
        })
      }).catch(() => {});
    }
  }

  return new Response(
    JSON.stringify({ ok: true, message: "Withdrawal request submitted for processing!", balance_usdt: newBalance }),
    { headers }
  );
}

async function handleAdminOverview(adminEmail, db, headers) {
  if (!(await isAuthorizedSuperAdmin(adminEmail, db))) {
    return new Response(JSON.stringify({ ok: false, message: "Super Admin access required." }), {
      status: 403,
      headers
    });
  }

  const settings = await db.prepare("SELECT telegram_chat_ids, updated_at FROM admin_settings WHERE id = 1").first();
  const admins = await db.prepare("SELECT id, email, role, added_by, created_at FROM super_admins ORDER BY id ASC").all();
  const plans = await db
    .prepare("SELECT vip_level, title, price_usdt, daily_usdt, duration_days, updated_at FROM vip_plans ORDER BY vip_level ASC")
    .all();
  const pendingWithdrawals = await db
    .prepare(
      `SELECT id, user_email, amount_usdt, status, details, created_at
       FROM transactions WHERE type = 'USDT Withdrawal' AND status = 'Pending' ORDER BY id DESC LIMIT 30`
    )
    .all();

  return new Response(
    JSON.stringify({
      ok: true,
      telegram_chat_ids: (settings && settings.telegram_chat_ids) || "",
      super_admins: admins.results || [],
      plans: plans.results || [],
      pending_withdrawals: pendingWithdrawals.results || []
    }),
    { headers }
  );
}

async function handleUpsertPlan(body, db, headers) {
  const adminEmail = (body.adminEmail || "").toLowerCase().trim();
  if (!(await isAuthorizedSuperAdmin(adminEmail, db))) {
    return new Response(JSON.stringify({ ok: false, message: "Super Admin access required." }), {
      status: 403,
      headers
    });
  }

  const vipLevel = Number(body.vip_level);
  const title = (body.title || `VIP ${vipLevel}`).trim();
  const priceUsdt = Number(body.price_usdt);
  const dailyUsdt = Number(body.daily_usdt);
  const durationDays = Number(body.duration_days);

  if (!Number.isInteger(vipLevel) || vipLevel < 1) {
    return new Response(JSON.stringify({ ok: false, message: "VIP level must be a whole number (1 or higher)." }), {
      status: 400,
      headers
    });
  }

  if (priceUsdt <= 0 || dailyUsdt < 0 || !Number.isInteger(durationDays) || durationDays < 1) {
    return new Response(
      JSON.stringify({ ok: false, message: "Provide valid price (>0), daily USDT (>=0), and duration days (>=1)." }),
      { status: 400, headers }
    );
  }

  await db
    .prepare(
      `INSERT INTO vip_plans (vip_level, title, price_usdt, daily_usdt, duration_days, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(vip_level) DO UPDATE SET
         title = excluded.title,
         price_usdt = excluded.price_usdt,
         daily_usdt = excluded.daily_usdt,
         duration_days = excluded.duration_days,
         updated_at = excluded.updated_at`
    )
    .bind(vipLevel, title, Number(priceUsdt.toFixed(2)), Number(dailyUsdt.toFixed(2)), durationDays, Date.now())
    .run();

  return new Response(
    JSON.stringify({ ok: true, message: `Saved ${title} (${priceUsdt.toFixed(2)} USDT • ${dailyUsdt.toFixed(2)}/day • ${durationDays}d).` }),
    { headers }
  );
}

async function handleDeletePlan(body, db, headers) {
  const adminEmail = (body.adminEmail || "").toLowerCase().trim();
  if (!(await isAuthorizedSuperAdmin(adminEmail, db))) {
    return new Response(JSON.stringify({ ok: false, message: "Super Admin access required." }), {
      status: 403,
      headers
    });
  }

  const vipLevel = Number(body.vip_level);
  if (!vipLevel) {
    return new Response(JSON.stringify({ ok: false, message: "Invalid VIP plan level." }), { status: 400, headers });
  }

  await db.prepare("DELETE FROM vip_plans WHERE vip_level = ?").bind(vipLevel).run();
  return new Response(JSON.stringify({ ok: true, message: `VIP ${vipLevel} plan removed.` }), { headers });
}

async function handleAdminSettings(body, db, headers) {
  const adminEmail = (body.adminEmail || "").toLowerCase().trim();
  if (!(await isAuthorizedSuperAdmin(adminEmail, db))) {
    return new Response(JSON.stringify({ ok: false, message: "Super Admin access required." }), {
      status: 403,
      headers
    });
  }

  const telegramChatIds = (body.telegram_chat_ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");

  await db
    .prepare("UPDATE admin_settings SET telegram_chat_ids = ?, updated_at = ? WHERE id = 1")
    .bind(telegramChatIds, Date.now())
    .run();

  return new Response(
    JSON.stringify({ ok: true, message: "Telegram IDs updated in Admin Panel.", telegram_chat_ids: telegramChatIds }),
    { headers }
  );
}

async function handleAddSuperAdmin(body, db, headers) {
  const adminEmail = (body.adminEmail || "").toLowerCase().trim();
  if (!(await isAuthorizedSuperAdmin(adminEmail, db))) {
    return new Response(JSON.stringify({ ok: false, message: "Super Admin access required." }), {
      status: 403,
      headers
    });
  }

  const newAdminEmail = (body.newAdminEmail || "").toLowerCase().trim();
  if (!newAdminEmail || !newAdminEmail.includes("@")) {
    return new Response(JSON.stringify({ ok: false, message: "Enter a valid email address for the new Super Admin." }), {
      status: 400,
      headers
    });
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO super_admins (email, role, added_by, created_at)
       VALUES (?, 'SUPER_ADMIN', ?, ?)`
    )
    .bind(newAdminEmail, adminEmail, Date.now())
    .run();

  return new Response(
    JSON.stringify({ ok: true, message: `${newAdminEmail} added as Super Admin.` }),
    { headers }
  );
}

async function handleWithdrawalAction(body, db, headers) {
  const adminEmail = (body.adminEmail || "").toLowerCase().trim();
  if (!(await isAuthorizedSuperAdmin(adminEmail, db))) {
    return new Response(JSON.stringify({ ok: false, message: "Super Admin access required." }), {
      status: 403,
      headers
    });
  }

  const txId = Number(body.txId);
  const decision = body.decision === "Approved" ? "Approved" : body.decision === "Rejected" ? "Rejected" : "";
  if (!txId || !decision) {
    return new Response(JSON.stringify({ ok: false, message: "Invalid withdrawal action." }), { status: 400, headers });
  }

  const tx = await db.prepare("SELECT * FROM transactions WHERE id = ?").bind(txId).first();
  if (!tx) return new Response(JSON.stringify({ ok: false, message: "Transaction not found." }), { status: 404, headers });

  if (decision === "Rejected" && tx.status === "Pending") {
    const refundAmt = Number(tx.amount_usdt || 0);
    await db
      .prepare("UPDATE users SET balance_usdt = ROUND(balance_usdt + ?, 2) WHERE email = ?")
      .bind(refundAmt, tx.user_email)
      .run();
  }

  await db.prepare("UPDATE transactions SET status = ? WHERE id = ?").bind(decision, txId).run();

  return new Response(
    JSON.stringify({ ok: true, message: `Withdrawal #${txId} marked as ${decision}.` }),
    { headers }
  );
}

function getHtmlApp() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PDF USDT — Worker Finance</title>
  <style>
    :root {
      --bg: #070b14;
      --surface: #0f172a;
      --surface-2: #162033;
      --border: rgba(148, 163, 184, 0.16);
      --text: #f8fafc;
      --muted: #94a3b8;
      --usdt: #26a17b;
      --usdt-bright: #34d399;
      --accent: #38bdf8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Inter", "Segoe UI", system-ui, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding-bottom: 88px; }

    .smart-alert {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%) translateY(-120%);
      max-width: 92vw;
      width: 420px;
      padding: 14px 18px;
      border-radius: 14px;
      font-size: 13.5px;
      font-weight: 600;
      z-index: 9999;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(12px);
      transition: transform 0.28s ease;
      text-align: center;
      border: 1px solid rgba(255, 255, 255, 0.14);
    }
    .smart-alert.show { transform: translateX(-50%) translateY(0); }
    .smart-alert.success { background: rgba(16, 185, 129, 0.94); color: #fff; }
    .smart-alert.error { background: rgba(239, 68, 68, 0.94); color: #fff; }
    .smart-alert.info { background: rgba(14, 165, 233, 0.94); color: #fff; }

    .auth-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: radial-gradient(circle at top, rgba(38, 161, 123, 0.2), transparent 55%), var(--bg);
    }
    .auth-card {
      width: 100%;
      max-width: 420px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
    }
    .brand { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 800; }
    .usdt-pill {
      background: rgba(38, 161, 123, 0.16);
      color: var(--usdt-bright);
      border: 1px solid rgba(52, 211, 153, 0.35);
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
    }
    .subtitle { color: var(--muted); font-size: 13px; margin: 8px 0 20px; }

    .field { margin-bottom: 12px; }
    input, select {
      width: 100%;
      padding: 13px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      font-size: 14px;
      outline: none;
    }
    input:focus, select:focus { border-color: var(--usdt-bright); }

    .btn {
      width: 100%;
      padding: 13px 16px;
      border-radius: 12px;
      border: none;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      transition: transform 0.12s ease, opacity 0.2s ease;
    }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-usdt { background: linear-gradient(135deg, var(--usdt), #15803d); color: #fff; }
    .btn-ghost { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
    .btn-sm { width: auto; padding: 8px 12px; font-size: 12px; }

    .switch-link { text-align: center; margin-top: 16px; font-size: 13px; color: var(--muted); }
    .switch-link span { color: var(--usdt-bright); font-weight: 700; cursor: pointer; }

    #appShell { display: none; }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .container { max-width: 920px; margin: 0 auto; padding: 18px 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      margin-bottom: 14px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px;
      text-align: center;
    }
    .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
    .stat-val { font-size: 15px; font-weight: 800; margin-top: 6px; color: var(--usdt-bright); }

    .balance-big {
      font-size: 32px;
      font-weight: 900;
      color: var(--usdt-bright);
      margin: 8px 0 14px;
    }

    .vip-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px;
    }
    .vip-card.active { border-color: var(--usdt-bright); }
    .vip-title { font-weight: 800; font-size: 15px; color: #fff; }
    .vip-price { font-size: 18px; font-weight: 800; color: var(--usdt-bright); margin: 6px 0; }
    .vip-daily { font-size: 12px; color: var(--accent); margin-bottom: 4px; }
    .vip-duration { font-size: 12px; color: var(--muted); margin-bottom: 10px; }

    .section { display: none; }
    .section.active { display: block; }

    .tx-item {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }
    .badge {
      padding: 4px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge.Approved { background: rgba(34, 197, 94, 0.18); color: #4ade80; }
    .badge.Pending { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
    .badge.Rejected { background: rgba(239, 68, 68, 0.18); color: #f87171; }

    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(12px);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-around;
      padding: 10px 6px;
      z-index: 100;
    }
    .nav-btn {
      background: none;
      border: none;
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 10px;
    }
    .nav-btn.active { color: var(--usdt-bright); background: rgba(38, 161, 123, 0.12); }

    .hidden { display: none; }

    @media (max-width: 600px) {
      .grid-3 { grid-template-columns: 1fr; }
      .grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <div id="smartAlert" class="smart-alert info"></div>

  <div id="authWrap" class="auth-wrap">
    <div class="auth-card">
      <div class="brand">
        <span>PDF WALLET</span>
        <span class="usdt-pill">WORKER JS</span>
      </div>
      <p class="subtitle">Cloudflare Worker + D1 • Instant USDT Settlements</p>

      <div id="loginBox">
        <form id="loginForm">
          <div class="field"><input type="email" id="loginEmail" placeholder="Email Address" required /></div>
          <div class="field"><input type="password" id="loginPassword" placeholder="Password" required /></div>
          <button type="submit" class="btn btn-usdt">Sign In</button>
        </form>
        <p class="switch-link">New to PDF USDT? <span onclick="toggleAuth('register')">Create Account</span></p>
      </div>

      <div id="registerBox" class="hidden">
        <form id="registerForm">
          <div class="field"><input type="text" id="regName" placeholder="Full Name" required /></div>
          <div class="field"><input type="email" id="regEmail" placeholder="Email Address" required /></div>
          <div class="field"><input type="tel" id="regPhone" placeholder="Phone Number" /></div>
          <div class="field"><input type="text" id="regReferral" placeholder="Referral Code (Optional)" /></div>
          <div class="field"><input type="password" id="regPassword" placeholder="Create Password" required /></div>
          <button type="submit" class="btn btn-usdt">Create USDT Account</button>
        </form>
        <p class="switch-link">Already have an account? <span onclick="toggleAuth('login')">Sign In</span></p>
      </div>
    </div>
  </div>

  <div id="appShell">
    <header class="topbar">
      <div class="brand" style="font-size:17px;">
        <span>PDF USDT</span>
        <span class="usdt-pill">WORKER JS</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="adminNavBtn" class="btn btn-ghost btn-sm hidden" onclick="switchSection('sec-admin', this)">Admin Panel</button>
        <button class="btn btn-ghost btn-sm" onclick="logout()">Logout</button>
      </div>
    </header>

    <main class="container">
      <section id="sec-home" class="section active">
        <div class="grid-3" style="margin-bottom:14px;">
          <div class="stat-card">
            <div class="stat-label">User ID</div>
            <div class="stat-val" id="statId">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active VIP</div>
            <div class="stat-val" id="statVip">VIP 0</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Settlement Asset</div>
            <div class="stat-val">USDT</div>
          </div>
        </div>

        <div class="card" style="text-align:center;">
          <div class="stat-label">Available USDT Balance</div>
          <div class="balance-big" id="balanceUsdt">0.00 USDT</div>
          <div class="grid-2">
            <div style="display:flex; gap:8px;">
              <input type="number" step="0.01" min="1" id="depositAmount" placeholder="USDT amount" />
              <button class="btn btn-usdt" style="width:auto; white-space:nowrap;" onclick="quickDeposit()">+ Deposit</button>
            </div>
            <button class="btn btn-ghost" onclick="switchSection('sec-wallet')">Withdraw USDT</button>
          </div>
        </div>

        <div class="card">
          <h3 style="margin-bottom:12px;">Smart VIP Packages (USDT)</h3>
          <div id="vipGrid" class="grid-2"></div>
        </div>
      </section>

      <section id="sec-earn" class="section">
        <div class="card">
          <h3>24-Hour Daily Check-In</h3>
          <p class="subtitle" style="margin-bottom:12px;">Earn +0.20 USDT every 24 hours. Stored directly in Cloudflare D1.</p>
          <button id="checkinBtn" class="btn btn-usdt" onclick="claimCheckin()">Claim +0.20 USDT</button>
        </div>

        <div class="card">
          <h3 style="margin-bottom:10px;">Active Packages</h3>
          <div id="activePackagesBox"></div>
        </div>
      </section>

      <section id="sec-history" class="section">
        <div class="card">
          <h3 style="margin-bottom:12px;">USDT Transaction History</h3>
          <div id="historyContainer"></div>
        </div>
      </section>

      <section id="sec-wallet" class="section">
        <div class="card">
          <h3 style="margin-bottom:10px;">USDT Withdrawal Address</h3>
          <div class="field">
            <select id="walletNetwork">
              <option value="TRC20">USDT (TRC20)</option>
              <option value="BEP20">USDT (BEP20)</option>
              <option value="ERC20">USDT (ERC20)</option>
            </select>
          </div>
          <div class="field"><input type="text" id="walletAddress" placeholder="Enter USDT Wallet Address" /></div>
          <button class="btn btn-usdt" onclick="saveWallet()">Save Withdrawal Wallet</button>
        </div>

        <div class="card">
          <h3 style="margin-bottom:10px;">4-Digit Security PIN</h3>
          <div class="field"><input type="password" maxlength="4" id="newPin" placeholder="Set 4-Digit PIN" /></div>
          <button class="btn btn-ghost" onclick="savePin()">Update Security PIN</button>
        </div>

        <div class="card">
          <h3 style="margin-bottom:10px;">Withdraw USDT (Min 2.00 USDT)</h3>
          <div class="field"><input type="number" step="0.01" min="2" id="withdrawAmount" placeholder="Amount in USDT" /></div>
          <div class="field"><input type="password" maxlength="4" id="withdrawPin" placeholder="Enter 4-Digit PIN" /></div>
          <button class="btn btn-usdt" onclick="submitWithdraw()">Confirm USDT Withdrawal</button>
        </div>
      </section>

      <section id="sec-admin" class="section">
        <div class="card">
          <h3 style="margin-bottom:8px;">Add / Edit VIP Plan (Price, Daily Yield & Duration)</h3>
          <p class="subtitle" style="margin-bottom:10px;">Create any VIP level or update price, daily yield, and duration days.</p>
          <div class="grid-2">
            <div class="field"><input type="number" min="1" step="1" id="planLevel" placeholder="VIP Level (e.g. 1, 2, 7)" required /></div>
            <div class="field"><input type="text" id="planTitle" placeholder="Plan Name (e.g. VIP 1)" /></div>
            <div class="field"><input type="number" min="0.01" step="0.01" id="planPrice" placeholder="Price (USDT)" required /></div>
            <div class="field"><input type="number" min="0" step="0.01" id="planDaily" placeholder="Daily Yield (USDT)" required /></div>
            <div class="field"><input type="number" min="1" step="1" id="planDuration" placeholder="Duration (Days, e.g. 30)" required /></div>
          </div>
          <button class="btn btn-usdt" onclick="saveVipPlan()">Save / Add VIP Plan</button>
          <div id="adminPlansList" style="margin-top:14px;"></div>
        </div>

        <div class="card">
          <h3 style="margin-bottom:8px;">Telegram Alert Chat IDs</h3>
          <p class="subtitle" style="margin-bottom:10px;">Configure comma-separated Telegram Chat IDs for withdrawal alerts.</p>
          <div class="field"><input type="text" id="adminTelegramIds" placeholder="e.g. 7544805601,8552397401" /></div>
          <button class="btn btn-usdt" onclick="saveTelegramSettings()">Save Telegram IDs</button>
        </div>

        <div class="card">
          <h3 style="margin-bottom:8px;">Add Super Admin</h3>
          <p class="subtitle" style="margin-bottom:10px;">Primary Super Admin: umarsaraki96@gmail.com</p>
          <div class="field"><input type="email" id="newSuperAdminEmail" placeholder="Enter new Super Admin email" /></div>
          <button class="btn btn-ghost" onclick="addSuperAdmin()">Add Super Admin</button>
          <div id="superAdminsList" style="margin-top:12px;"></div>
        </div>

        <div class="card">
          <h3 style="margin-bottom:10px;">Pending USDT Withdrawals</h3>
          <div id="pendingWithdrawalsList"></div>
        </div>
      </section>
    </main>

    <nav class="bottom-nav">
      <button class="nav-btn active" data-target="sec-home" onclick="switchSection('sec-home', this)">Home</button>
      <button class="nav-btn" data-target="sec-earn" onclick="switchSection('sec-earn', this)">Check-In & VIP</button>
      <button class="nav-btn" data-target="sec-history" onclick="switchSection('sec-history', this)">History</button>
      <button class="nav-btn" data-target="sec-wallet" onclick="switchSection('sec-wallet', this)">USDT Wallet</button>
    </nav>
  </div>

  <script>
    let plans = [];
    let currentUser = null;
    let transactions = [];

    function smartAlert(msg, type = "info") {
      const el = document.getElementById("smartAlert");
      const cleanMsg = String(msg || "Action completed.").slice(0, 140);
      el.textContent = cleanMsg;
      el.className = "smart-alert " + type + " show";
      clearTimeout(window.__alertTimer);
      window.__alertTimer = setTimeout(() => {
        el.classList.remove("show");
      }, 3400);
    }

    function toggleAuth(mode) {
      document.getElementById("loginBox").classList.toggle("hidden", mode !== "login");
      document.getElementById("registerBox").classList.toggle("hidden", mode !== "register");
    }

    function switchSection(id, btn) {
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
      document.getElementById(id).classList.add("active");
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      if (btn && btn.classList.contains("nav-btn")) btn.classList.add("active");
      else {
        const match = document.querySelector('.nav-btn[data-target="' + id + '"]');
        if (match) match.classList.add("active");
      }
      if (id === "sec-admin") loadAdminOverview();
    }

    async function apiCall(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...options
      });
      return res.json().catch(() => ({ ok: false, message: "Network response error." }));
    }

    document.getElementById("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const res = await apiCall("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          mode: "register",
          fullname: document.getElementById("regName").value,
          email: document.getElementById("regEmail").value,
          phone: document.getElementById("regPhone").value,
          referral: document.getElementById("regReferral").value,
          password: document.getElementById("regPassword").value
        })
      });
      if (!res.ok) return smartAlert(res.message, "error");
      smartAlert(res.message, "success");
      toggleAuth("login");
    });

    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.toLowerCase().trim();
      const res = await apiCall("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          mode: "login",
          email,
          password: document.getElementById("loginPassword").value
        })
      });
      if (!res.ok) return smartAlert(res.message, "error");
      localStorage.setItem("pdf_usdt_email", email);
      smartAlert(res.message, "success");
      await enterApp();
    });

    async function enterApp() {
      const email = localStorage.getItem("pdf_usdt_email");
      if (!email) return;
      const data = await apiCall("/api/user?email=" + encodeURIComponent(email));
      if (!data.ok) {
        localStorage.removeItem("pdf_usdt_email");
        return;
      }
      currentUser = data.user;
      plans = data.plans || [];
      transactions = data.transactions || [];
      document.getElementById("authWrap").style.display = "none";
      document.getElementById("appShell").style.display = "block";
      document.getElementById("adminNavBtn").classList.toggle("hidden", !currentUser.is_super_admin);
      renderAll();
    }

    function renderAll() {
      if (!currentUser) return;
      const vipLevel = Number(currentUser.vip_level || 0);
      const bal = Number(currentUser.balance_usdt || 0).toFixed(2);

      document.getElementById("statId").textContent = currentUser.custom_id;
      document.getElementById("statVip").textContent = "VIP " + vipLevel;
      document.getElementById("balanceUsdt").textContent = bal + " USDT";
      document.getElementById("walletAddress").value = currentUser.wallet_address || "";
      document.getElementById("walletNetwork").value = currentUser.wallet_network || "TRC20";

      const vipGrid = document.getElementById("vipGrid");
      if (!plans.length) {
        vipGrid.innerHTML = '<p style="color:var(--muted); font-size:13px;">No VIP plans configured yet.</p>';
      } else {
        vipGrid.innerHTML = plans.map((p) => {
          const level = Number(p.vip_level);
          const isCurrent = level === vipLevel;
          const isLower = level <= vipLevel;
          const label = p.title || ("VIP " + level);
          return (
            '<div class="vip-card ' + (isCurrent ? "active" : "") + '">' +
              '<div class="vip-title">' + label + '</div>' +
              '<div class="vip-price">' + Number(p.price_usdt).toFixed(2) + ' USDT</div>' +
              '<div class="vip-daily">Daily Yield: ' + Number(p.daily_usdt).toFixed(2) + ' USDT</div>' +
              '<div class="vip-duration">Duration: ' + Number(p.duration_days) + ' Days</div>' +
              '<button class="btn btn-usdt" ' + (isLower ? "disabled" : "") + ' onclick="buyVip(' + level + ')">' +
                (isCurrent ? "Active Plan" : isLower ? "Unavailable" : "Upgrade to " + label) +
              '</button>' +
            '</div>'
          );
        }).join("");
      }

      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const vip0Active = (Date.now() - Number(currentUser.created_at || Date.now())) < threeDaysMs;
      let activeHtml = "";
      if (vip0Active) {
        activeHtml +=
          '<div class="tx-item">' +
            '<div>' +
              '<strong>VIP 0 Welcome Bonus</strong>' +
              '<div style="font-size:12px; color:var(--muted);">3-Day Trial Yield: 0.50 USDT / day</div>' +
            '</div>' +
            '<span class="badge Approved">Active</span>' +
          '</div>';
      }
      const activePlan = plans.find((x) => Number(x.vip_level) === vipLevel);
      if (vipLevel > 0 && activePlan) {
        const expText = currentUser.vip_expires_at
          ? ("Expires: " + new Date(Number(currentUser.vip_expires_at)).toLocaleDateString())
          : ("Duration: " + Number(activePlan.duration_days) + " Days");
        activeHtml +=
          '<div class="tx-item">' +
            '<div>' +
              '<strong>' + (activePlan.title || ("VIP " + vipLevel)) + '</strong>' +
              '<div style="font-size:12px; color:var(--muted);">Daily Yield: ' + Number(activePlan.daily_usdt).toFixed(2) + ' USDT • ' + expText + '</div>' +
            '</div>' +
            '<span class="badge Approved">Purchased</span>' +
          '</div>';
      }
      document.getElementById("activePackagesBox").innerHTML =
        activeHtml || '<p style="color:var(--muted); font-size:13px;">No active packages right now.</p>';

      const checkinBtn = document.getElementById("checkinBtn");
      const twentyFourHours = 24 * 60 * 60 * 1000;
      const lastMs = Number(currentUser.last_checkin_ms || 0);
      if (lastMs && Date.now() - lastMs < twentyFourHours) {
        const hrs = Math.ceil((twentyFourHours - (Date.now() - lastMs)) / (1000 * 60 * 60));
        checkinBtn.disabled = true;
        checkinBtn.textContent = "Claimed Today • Next in " + hrs + "h";
      } else {
        checkinBtn.disabled = false;
        checkinBtn.textContent = "Claim +0.20 USDT";
      }

      const histBox = document.getElementById("historyContainer");
      if (!transactions.length) {
        histBox.innerHTML = '<p style="color:var(--muted); font-size:13px;">No USDT transactions yet.</p>';
      } else {
        histBox.innerHTML = transactions.map((t) =>
          '<div class="tx-item">' +
            '<div>' +
              '<strong>' + t.type + '</strong>' +
              '<div style="font-size:12px; color:var(--muted);">' + (t.details || "") + '</div>' +
              '<div style="font-size:11px; color:var(--muted);">' + new Date(t.created_at).toLocaleString() + '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<div style="font-weight:800; color:var(--usdt-bright);">' + Number(t.amount_usdt || 0).toFixed(2) + ' USDT</div>' +
              '<span class="badge ' + t.status + '">' + t.status + '</span>' +
            '</div>' +
          '</div>'
        ).join("");
      }
    }

    function fillPlanForm(plan) {
      document.getElementById("planLevel").value = plan.vip_level;
      document.getElementById("planTitle").value = plan.title;
      document.getElementById("planPrice").value = plan.price_usdt;
      document.getElementById("planDaily").value = plan.daily_usdt;
      document.getElementById("planDuration").value = plan.duration_days;
    }

    async function saveVipPlan() {
      const levelVal = Number(document.getElementById("planLevel").value);
      const titleVal = (document.getElementById("planTitle").value || ("VIP " + levelVal)).trim();
      const priceVal = Number(document.getElementById("planPrice").value);
      const dailyVal = Number(document.getElementById("planDaily").value);
      const durationVal = Number(document.getElementById("planDuration").value);

      const res = await apiCall("/api/admin/upsert-plan", {
        method: "POST",
        body: JSON.stringify({
          adminEmail: currentUser.email,
          vip_level: levelVal,
          title: titleVal,
          price_usdt: priceVal,
          daily_usdt: dailyVal,
          duration_days: durationVal
        })
      });
      smartAlert(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        await loadAdminOverview();
        await enterApp();
      }
    }

    async function deleteVipPlan(vipLevel) {
      const res = await apiCall("/api/admin/delete-plan", {
        method: "POST",
        body: JSON.stringify({
          adminEmail: currentUser.email,
          vip_level: vipLevel
        })
      });
      smartAlert(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        await loadAdminOverview();
        await enterApp();
      }
    }

    async function loadAdminOverview() {
      if (!currentUser || !currentUser.is_super_admin) return;
      const data = await apiCall("/api/admin/overview?adminEmail=" + encodeURIComponent(currentUser.email));
      if (!data.ok) return smartAlert(data.message, "error");

      const adminPlans = data.plans || [];
      const plansBox = document.getElementById("adminPlansList");
      if (!adminPlans.length) {
        plansBox.innerHTML = '<p style="color:var(--muted); font-size:13px;">No VIP plans yet. Add one above.</p>';
      } else {
        plansBox.innerHTML = adminPlans.map((p, idx) =>
          '<div class="tx-item">' +
            '<div>' +
              '<strong>' + p.title + ' (Level ' + p.vip_level + ')</strong>' +
              '<div style="font-size:12px; color:var(--usdt-bright);">Price: ' + Number(p.price_usdt).toFixed(2) + ' USDT • Daily: ' + Number(p.daily_usdt).toFixed(2) + ' USDT • Duration: ' + Number(p.duration_days) + ' Days</div>' +
            '</div>' +
            '<div style="display:flex; gap:6px;">' +
              '<button class="btn btn-ghost btn-sm" onclick="editPlanAt(' + idx + ')">Edit</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="deleteVipPlan(' + Number(p.vip_level) + ')">Delete</button>' +
            '</div>' +
          '</div>'
        ).join("");
        window.__adminPlansCache = adminPlans;
      }

      document.getElementById("adminTelegramIds").value = data.telegram_chat_ids || "";

      const adminsBox = document.getElementById("superAdminsList");
      adminsBox.innerHTML = (data.super_admins || []).map((a) =>
        '<div class="tx-item">' +
          '<div>' +
            '<strong>' + a.email + '</strong>' +
            '<div style="font-size:11px; color:var(--muted);">Added by: ' + a.added_by + '</div>' +
          '</div>' +
          '<span class="badge Approved">' + a.role + '</span>' +
        '</div>'
      ).join("");

      const pendingBox = document.getElementById("pendingWithdrawalsList");
      const pendings = data.pending_withdrawals || [];
      if (!pendings.length) {
        pendingBox.innerHTML = '<p style="color:var(--muted); font-size:13px;">No pending withdrawals.</p>';
      } else {
        pendingBox.innerHTML = pendings.map((w) =>
          '<div class="tx-item">' +
            '<div>' +
              '<strong>#' + w.id + ' • ' + w.user_email + '</strong>' +
              '<div style="font-size:12px; color:var(--usdt-bright);">' + Number(w.amount_usdt).toFixed(2) + ' USDT</div>' +
              '<div style="font-size:11px; color:var(--muted);">' + (w.details || "") + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:6px;">' +
              '<button class="btn btn-usdt btn-sm" onclick="decideWithdrawal(' + w.id + ', \'Approved\')">Approve</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="decideWithdrawal(' + w.id + ', \'Rejected\')">Reject</button>' +
            '</div>' +
          '</div>'
        ).join("");
      }
    }

    function editPlanAt(idx) {
      const list = window.__adminPlansCache || [];
      if (list[idx]) fillPlanForm(list[idx]);
    }

    async function saveTelegramSettings() {
      const res = await apiCall("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({
          adminEmail: currentUser.email,
          telegram_chat_ids: document.getElementById("adminTelegramIds").value
        })
      });
      smartAlert(res.message, res.ok ? "success" : "error");
      if (res.ok) await loadAdminOverview();
    }

    async function addSuperAdmin() {
      const res = await apiCall("/api/admin/add-super-admin", {
        method: "POST",
        body: JSON.stringify({
          adminEmail: currentUser.email,
          newAdminEmail: document.getElementById("newSuperAdminEmail").value
        })
      });
      if (res.ok) document.getElementById("newSuperAdminEmail").value = "";
      smartAlert(res.message, res.ok ? "success" : "error");
      if (res.ok) await loadAdminOverview();
    }

    async function decideWithdrawal(txId, decision) {
      const res = await apiCall("/api/admin/withdrawal-action", {
        method: "POST",
        body: JSON.stringify({
          adminEmail: currentUser.email,
          txId,
          decision
        })
      });
      smartAlert(res.message, res.ok ? "success" : "error");
      if (res.ok) {
        await loadAdminOverview();
        await enterApp();
      }
    }

    async function quickDeposit() {
      const amt = Number(document.getElementById("depositAmount").value);
      const res = await apiCall("/api/deposit", {
        method: "POST",
        body: JSON.stringify({ email: currentUser.email, amount: amt })
      });
      if (!res.ok) return smartAlert(res.message, "error");
      document.getElementById("depositAmount").value = "";
      smartAlert(res.message, "success");
      await enterApp();
    }

    async function buyVip(vip) {
      const res = await apiCall("/api/buy-vip", {
        method: "POST",
        body: JSON.stringify({ email: currentUser.email, vip })
      });
      if (!res.ok) return smartAlert(res.message, "error");
      smartAlert(res.message, "success");
      await enterApp();
    }

    async function claimCheckin() {
      const res = await apiCall("/api/checkin", {
        method: "POST",
        body: JSON.stringify({ email: currentUser.email })
      });
      if (!res.ok) return smartAlert(res.message, "error");
      smartAlert(res.message, "success");
      await enterApp();
    }

    async function saveWallet() {
      const res = await apiCall("/api/payment-method", {
        method: "POST",
        body: JSON.stringify({
          email: currentUser.email,
          wallet_network: document.getElementById("walletNetwork").value,
          wallet_address: document.getElementById("walletAddress").value
        })
      });
      smartAlert(res.message, res.ok ? "success" : "error");
      if (res.ok) await enterApp();
    }

    async function savePin() {
      const res = await apiCall("/api/security-pin", {
        method: "POST",
        body: JSON.stringify({
          email: currentUser.email,
          pin: document.getElementById("newPin").value
        })
      });
      if (res.ok) document.getElementById("newPin").value = "";
      smartAlert(res.message, res.ok ? "success" : "error");
    }

    async function submitWithdraw() {
      const res = await apiCall("/api/withdraw", {
        method: "POST",
        body: JSON.stringify({
          email: currentUser.email,
          amount: Number(document.getElementById("withdrawAmount").value),
          pin: document.getElementById("withdrawPin").value
        })
      });
      if (!res.ok) return smartAlert(res.message, "error");
      document.getElementById("withdrawAmount").value = "";
      document.getElementById("withdrawPin").value = "";
      smartAlert(res.message, "success");
      await enterApp();
    }

    function logout() {
      localStorage.removeItem("pdf_usdt_email");
      location.reload();
    }

    window.addEventListener("DOMContentLoaded", enterApp);
  </script>
</body>
</html>`;
}

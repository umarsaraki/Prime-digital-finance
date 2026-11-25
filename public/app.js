let plans = [];
let currentUser = null;
let transactions = [];
let siteSettings = {};
let teamData = { members: [], total: 0, active: 0 };
let unread = 0;
let currentVip = null;
let commissions = [];
let adminPending = null;
let countdownInterval = null;
let pollInterval = null;
let viewStack = [];
let currentView = "sec-home";
let historyFilter = "all";

const $ = (id) => document.getElementById(id);
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function getToken() { try { return localStorage.getItem("pdf_session_token") || ""; } catch { return ""; } }
function setToken(v) { try { v ? localStorage.setItem("pdf_session_token", v) : localStorage.removeItem("pdf_session_token"); } catch { /* storage blocked */ } }
const usdt = (n) => `${Number(n || 0).toFixed(2)} USDT`;

function smartAlert(msg, type = "info") {
  const el = $("smartAlert");
  el.textContent = String(msg || "Done.").slice(0, 260);
  el.className = `smart-alert ${type} show`;
  clearTimeout(window.__alertTimer);
  window.__alertTimer = setTimeout(() => el.classList.remove("show"), 3300);
}

function toggleAuth(mode) {
  $("loginBox").classList.toggle("hidden", mode !== "login");
  $("registerBox").classList.toggle("hidden", mode !== "register");
}

function showAuth() {
  clearInterval(countdownInterval); clearInterval(pollInterval);
  currentUser = null;
  $("authWrap").style.display = "flex";
  $("appShell").style.display = "none";
}

/* ---------- navigation: every page opens only when tapped ---------- */
function showSection(id) {
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.remove("active"));
  const t = $(id); if (t) t.classList.add("active");
  window.scrollTo({ top: 0 });
}
function setNav(id) {
  document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("active", b.dataset.target === id));
}
function switchTab(id) {
  viewStack = []; currentView = id;
  showSection(id); setNav(id); onViewOpen(id);
}
function openView(id, navTab) {
  viewStack.push(currentView); currentView = id;
  showSection(id);
  if (navTab !== undefined) setNav(navTab);
  onViewOpen(id);
}
function goBack() {
  const prev = viewStack.pop() || "sec-home";
  currentView = prev;
  showSection(prev);
  if (document.querySelector(`.nav-tab[data-target="${prev}"]`)) setNav(prev);
  onViewOpen(prev);
}
function onViewOpen(id) {
  if (id === "sec-admin") loadAdminOverview();
  if (id === "sub-company") loadCompany();
  if (id === "sub-rewards") renderRewards();
  if (id === "adm-earnings") { loadAdminOverview(); loadEarnings(); }
  if (id === "adm-commissions") { loadAdminOverview(); loadCommissions(); }
  if (id === "adm-company") { loadAdminOverview(); loadAdminCompanyDocs(); }
  if (id === "adm-dashboard") loadDashboard();
  if (id === "adm-members") searchAdminUsers();
  if (id === "adm-deposits") loadAdminDeposits();
  if (id === "adm-withdrawals") loadAdminWithdrawals();
  if (id === "adm-purchases") loadAdminPurchases();
  if (id === "adm-audit") loadAudit();
  if (id === "adm-health") loadHealth();
  if (["adm-plans", "adm-notify", "adm-pay", "adm-global", "adm-site", "adm-links", "adm-admins"].includes(id)) loadAdminOverview();
  if (id === "sub-notifs") loadNotifications();
  if (id === "sub-history") renderHistory();
  if (["sub-account", "sub-deposit", "sub-withdraw", "sub-wallet", "sub-security", "sub-members", "sub-invite"].includes(id)) renderApp();
}

async function api(path, options = {}) {
  const token = getToken();
  try {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { ...options, headers });
    let data;
    try { data = await res.json(); } catch { data = { ok: false, message: "Unexpected server response." }; }
    if (res.status === 503 && data.maintenance) { showMaintenance(data.message); return data; }
    if (res.status === 401 && token && path !== "/api/auth") { setToken(""); showAuth(); }
    return data;
  } catch { return { ok: false, message: "Connection failed. Please try again." }; }
}

function showMaintenance(msg) {
  clearInterval(pollInterval);
  $("maintMsg").textContent = msg || "We are performing maintenance. Please check back soon.";
  $("maintenanceScreen").classList.remove("hidden");
}

/* ---------- auth ---------- */
$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/auth", {
    method: "POST",
    body: JSON.stringify({ mode: "register", fullname: $("regName").value, email: $("regEmail").value, phone: $("regPhone").value, referral: $("regReferral").value, password: $("regPassword").value, setup_key: $("regSetupKey").value })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  $("regPassword").value = ""; $("regSetupKey").value = "";
  toggleAuth("login");
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/auth", { method: "POST", body: JSON.stringify({ mode: "login", email: $("loginEmail").value.toLowerCase().trim(), password: $("loginPassword").value }) });
  if (!res.ok) return smartAlert(res.message, "error");
  setToken(res.token);
  $("loginPassword").value = "";
  smartAlert(res.message, "success");
  await enterApp();
});

async function loadPublicSettings() {
  const d = await api("/api/public-settings");
  if (d.ok) { siteSettings = d.settings || {}; renderPublicSettings(); }
}

function applyData(d) {
  currentUser = d.user;
  plans = d.plans || [];
  transactions = d.transactions || [];
  siteSettings = d.settings || siteSettings;
  teamData = d.team || { members: [], total: 0, active: 0 };
  unread = Number(d.unread || 0);
  currentVip = d.current_vip || null;
  commissions = d.commissions || [];
  adminPending = d.admin_pending || null;
}

async function enterApp() {
  if (!getToken()) return showAuth();
  const d = await api("/api/user");
  if (!d.ok) { setToken(""); return showAuth(); }
  applyData(d);
  $("authWrap").style.display = "none";
  $("appShell").style.display = "block";
  $("adminTopBtn").classList.toggle("hidden", !currentUser.is_super_admin);
  viewStack = []; currentView = "sec-home"; showSection("sec-home"); setNav("sec-home");
  renderApp(); renderPublicSettings(); applyBadges();
  startCountdownTicker();
  clearInterval(pollInterval);
  pollInterval = setInterval(refreshLight, 45000);
}

// Refresh data after an action without leaving the page the member is on.
async function refreshData() {
  const d = await api("/api/user");
  if (!d.ok) return;
  applyData(d);
  $("adminTopBtn").classList.toggle("hidden", !currentUser.is_super_admin);
  renderApp(); renderPublicSettings(); applyBadges();
  if (currentView === "sub-history") renderHistory();
}
async function refreshLight() {
  if (!currentUser || document.hidden) return;
  const d = await api("/api/user");
  if (!d.ok) return;
  applyData(d);
  $("homeBalanceVal").textContent = usdt(currentUser.balance_usdt);
  $("withdrawBalance").textContent = usdt(currentUser.balance_usdt);
  applyBadges();
  if (currentView === "sub-history") renderHistory();
}

function setBadge(id, n) { const el = $(id); if (!el) return; el.textContent = n > 99 ? "99+" : String(n); el.classList.toggle("hidden", !(n > 0)); }
function applyBadges() {
  setBadge("bellBadge", unread);
  const d = adminPending?.deposits || 0, w = adminPending?.withdrawals || 0;
  setBadge("adminBadge", d + w); setBadge("admBadgeDeposits", d); setBadge("admBadgeWithdrawals", w);
}

/* ---------- rendering ---------- */
function planCardHtml(p, idx, vipLevel) {
  const lvl = Number(p.vip_level);
  const tier = ["", "tier-blue", "tier-gold"][idx % 3];
  const ico = ["👑", "🥈", "🏆"][idx % 3];
  return `<div class="vip-card-item ${tier}" role="button" tabindex="0" onclick="openPlan(${lvl})" onkeydown="if(event.key==='Enter')openPlan(${lvl})">
    <div>
      <div class="vip-pill-head">${escapeHtml(p.title || `VIP ${lvl}`)}</div>
      <div class="vip-wreath-icon">${ico}</div>
      <div class="vip-price-big">${Number(p.price_usdt).toFixed(2)} USDT</div>
      <div class="vip-line-meta">${Number(p.duration_days)} Days</div>
    </div>
    <div class="vip-upgrade-btn">${lvl === vipLevel ? "Active ✓" : "View Plan ›"}</div>
  </div>`;
}

function renderApp() {
  if (!currentUser) return;
  const vipLevel = Number(currentUser.vip_level || 0);
  const memberId = currentUser.custom_id;
  const activePlan = plans.find((x) => Number(x.vip_level) === vipLevel);

  $("homeMemberId").textContent = memberId;
  $("profileMemberId").textContent = memberId;
  $("homeBalanceVal").textContent = usdt(currentUser.balance_usdt);
  $("withdrawBalance").textContent = usdt(currentUser.balance_usdt);
  const pill = vipLevel > 0 ? "✓ Active Plan" : "Member";
  $("homeStatusPill").textContent = pill; $("profileStatusPill").textContent = pill;
  $("referralLinkInput").value = `${window.location.origin}/?ref=${encodeURIComponent(memberId)}`;

  // account information
  $("accName").textContent = currentUser.fullname || "—";
  $("accEmail").textContent = currentUser.email;
  $("accMemberId").textContent = memberId;
  $("accPhone").textContent = currentUser.phone || "—";
  $("accJoined").textContent = new Date(Number(currentUser.created_at)).toLocaleDateString();
  $("accProduct").textContent = vipLevel > 0 ? (activePlan?.title || `VIP ${vipLevel}`) : "No active plan";
  $("accWallet").textContent = currentUser.wallet_address ? `${currentUser.wallet_network}: ${currentUser.wallet_address}` : "Not set";
  $("secPinStatus").textContent = currentUser.has_pin ? "Set ✓" : "Not set";
  $("secWalletStatus").textContent = currentUser.wallet_address ? "Saved ✓" : "Not set";
  $("pinStatus").textContent = currentUser.has_pin ? "A PIN is already set. Enter a new one to replace it." : "You have not set a PIN yet. It is required for withdrawals.";
  if (document.activeElement !== $("walletAddress")) $("walletAddress").value = currentUser.wallet_address || "";
  if (document.activeElement !== $("walletNetwork")) $("walletNetwork").value = currentUser.wallet_network || "TRC20";

  // team
  const weekAgo = Date.now() - 7 * 86400000;
  $("teamTotalMembers").textContent = String(teamData.total || 0);
  $("teamActiveMembers").textContent = String(teamData.active || 0);
  $("teamRecentVal").textContent = String((teamData.members || []).filter((m) => Number(m.created_at) > weekAgo).length);
  $("teamMembersList").innerHTML = (teamData.members || []).map((m) =>
    `<div class="tx-row"><div><strong>${escapeHtml(m.fullname)}</strong><div class="tx-sub">${escapeHtml(m.custom_id)}</div></div><span class="tx-sub">${new Date(Number(m.created_at)).toLocaleDateString()}<br>${m.purchased ? "Plan purchased" : "No plan yet"}</span></div>`
  ).join("") || `<p class="tx-sub">No referred members yet.</p>`;

  // plans: only plans created in the admin panel
  $("homeVipGrid").innerHTML = plans.length ? plans.map((p, i) => planCardHtml(p, i, vipLevel)).join("") : `<p class="tx-sub">No plans available yet.</p>`;

  // products: current plan
  $("prodDailyVal").textContent = usdt(siteSettings.checkin_reward);
  $("checkinNote").textContent = siteSettings.checkin_requires_vip !== "0" ? `Requires an active plan • once every ${siteSettings.checkin_interval_hours || 24} hours` : `Claim once every ${siteSettings.checkin_interval_hours || 24} hours`;
  renderEarnCard();
  const cv = currentVip;
  $("prodEmpty").classList.toggle("hidden", !!cv);
  document.querySelector(".current-product-card").classList.toggle("hidden", !cv);
  if (cv) {
    $("prodActiveTitle").textContent = cv.plan_title || `VIP ${cv.vip_level}`;
    $("prodActivePrice").textContent = usdt(cv.price_usdt);
    $("prodDuration").textContent = `${Math.round((Number(cv.expires_at) - Number(cv.started_at)) / 86400000)} Days`;
    $("prodDaysLeft").textContent = `${Math.max(0, Math.ceil((Number(cv.expires_at) - Date.now()) / 86400000))} Days`;
    $("prodStartDate").textContent = new Date(Number(cv.started_at)).toLocaleDateString();
    $("prodStatusPill").textContent = `Active • Level ${cv.vip_level} • until ${new Date(Number(cv.expires_at)).toLocaleDateString()}`;
  }
}

/* ---------- history ---------- */
const HIST = {
  all: () => true,
  deposits: (t) => /deposit/i.test(t.type),
  withdrawals: (t) => /withdraw/i.test(t.type),
  plans: (t) => /purchase|upgrade/i.test(t.type),
  rewards: (t) => /check-in|bonus|earning|commission/i.test(t.type),
  activity: (t) => t.type === "Account Activity"
};
function setHistoryFilter(f) {
  historyFilter = f;
  document.querySelectorAll("#historyChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.f === f));
  renderHistory();
}
function renderHistory() {
  const list = transactions.filter(HIST[historyFilter] || HIST.all);
  $("txHistoryList").innerHTML = list.map((t) => {
    const isActivity = t.type === "Account Activity";
    let sign = "";
    if (t.status === "Approved" && !isActivity) sign = /deposit|check-in|bonus|earning|commission|credit/i.test(t.type) ? "+" : "−";
    return `<div class="tx-row">
      <div><strong>${escapeHtml(t.type)}</strong><div class="tx-sub">${escapeHtml(t.details || "")} • ${new Date(Number(t.created_at)).toLocaleString()}</div></div>
      ${isActivity ? "" : `<div style="text-align:right;"><div style="font-weight:900;color:var(--neon-green);">${sign}${Number(t.amount_usdt || 0).toFixed(2)} USDT</div><span class="st-badge ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></div>`}
    </div>`;
  }).join("") || `<p class="tx-sub">Nothing here yet.</p>`;
}

/* ---------- plan detail ---------- */
function openPlan(lvl) {
  const p = plans.find((x) => Number(x.vip_level) === Number(lvl)); if (!p) return;
  const vipLevel = Number(currentUser.vip_level || 0);
  const isCurrent = Number(p.vip_level) === vipLevel;
  const lower = Number(p.vip_level) < vipLevel;
  const balance = Number(currentUser.balance_usdt || 0);
  const enough = balance >= Number(p.price_usdt);
  $("planDetailTitle").textContent = p.title || `VIP ${lvl}`;
  const desc = String(p.description || "").trim();
  let action;
  if (isCurrent) action = `<button type="button" class="btn-deposit-green full-w" disabled>Your current plan</button>`;
  else if (lower) action = `<button type="button" class="btn-deposit-green full-w" disabled>Lower than your current plan</button>`;
  else if (!enough) action = `<button type="button" class="btn-gold-cta full-w" onclick="openDepositBox()">Balance too low — Make a Deposit</button>`;
  else action = `<button type="button" class="btn-gold-cta full-w" onclick="buyVip(${Number(p.vip_level)})">Activate for ${Number(p.price_usdt).toFixed(2)} USDT</button>`;
  const perk = siteSettings.checkin_requires_vip !== "0" && Number(siteSettings.checkin_reward) > 0 ? `<div class="info-row"><span>Includes</span><strong>Daily check-in (${usdt(siteSettings.checkin_reward)})</strong></div>` : "";
  const earnOn = siteSettings.earnings_enabled === "1" && Number(p.daily_usdt) > 0;
  const earnRow = earnOn ? `<div class="info-row"><span>Daily earning</span><strong>${usdt(p.daily_usdt)}</strong></div>${Number(p.earn_total_limit) > 0 ? `<div class="info-row"><span>Total earning limit</span><strong>${usdt(p.earn_total_limit)}</strong></div>` : ""}` : "";
  const earnNote = earnOn ? `<p class="tx-sub">${escapeHtml(earnDisclaimer())}</p>` : "";
  $("planDetailBody").innerHTML = `
    <div class="dark-panel neon-green-box">
      <div class="info-row"><span>Price</span><strong>${usdt(p.price_usdt)}</strong></div>
      <div class="info-row"><span>Duration</span><strong>${Number(p.duration_days)} Days</strong></div>
      ${perk}${earnRow}
      <div class="info-row"><span>Your balance</span><strong>${usdt(balance)}</strong></div>
      <div class="info-row"><span>Status</span><strong>${isCurrent ? "Active" : lower ? "Lower tier" : "Available"}</strong></div>
    </div>
    ${desc ? `<div class="dark-panel neon-green-box"><h3 class="panel-heading">About this plan</h3><p class="plan-desc">${escapeHtml(desc).replace(/\n/g, "<br />")}</p></div>` : ""}
    <div class="dark-panel neon-green-box">${action}<p class="tx-sub" style="margin-top:8px;">The price is deducted from your balance when you activate.</p>${earnNote}</div>`;
  openView("sub-plan");
}

function setExternalLink(id, url) {
  const el = $(id); if (!el) return;
  if (url && /^https:\/\//i.test(url)) { el.href = url; el.classList.remove("hidden"); } else { el.href = "#"; el.classList.add("hidden"); }
}

function renderPublicSettings() {
  const cfg = siteSettings || {};
  const banner = $("heroBannerImg");
  if (cfg.banner_key) { banner.src = `/media/${cfg.banner_key}`; banner.classList.remove("hidden"); } else { banner.removeAttribute("src"); banner.classList.add("hidden"); }
  document.querySelectorAll(".brand-name").forEach((el) => { el.innerHTML = `${escapeHtml(cfg.company_name || "Prime Digital Finance")} <span>(${escapeHtml(cfg.brand_short || "PDF")})</span>`; });
  $("heroTitle").textContent = cfg.hero_title || "PRIME DIGITAL FINANCE";
  $("heroSubtitle").textContent = cfg.hero_subtitle || "";
  document.querySelectorAll(".brand-tagline").forEach((el) => { el.textContent = cfg.tagline || "FINANCE • TRANSPARENCY • CONTROL"; });
  $("announcementText").textContent = cfg.announcement || "";
  const faq = document.querySelector("#faqPanel p"); if (faq) faq.textContent = cfg.faq_text || "Contact support if you need help.";
  setExternalLink("liveChatLink", cfg.live_chat_url); setExternalLink("supportChatLink", cfg.live_chat_url);
  setExternalLink("telegramChannelLink", cfg.telegram_url); setExternalLink("whatsappChannelLink", cfg.whatsapp_url);
  $("depositNetworkLabel").textContent = cfg.deposit_network || "TRC20";
  $("depositAddressLabel").textContent = cfg.deposit_address || "Admin has not configured a deposit wallet.";
  $("depositInstructionsLabel").textContent = cfg.deposit_instructions || "";
  $("depositLimitsLabel").textContent = `${cfg.deposit_min || 1}–${cfg.deposit_max || 5000} USDT`;
  $("withdrawHeading").textContent = `Withdraw (min. ${cfg.withdraw_min || 2} USDT)`;
  $("withdrawAmount").min = cfg.withdraw_min || 2;
  $("regClosedNote").classList.toggle("hidden", cfg.registration_open !== "0");
}

function startCountdownTicker() {
  clearInterval(countdownInterval);
  const tick = () => {
    const el = $("countdownClock"), btn = $("prodCheckinBtn");
    if (!el || !currentUser) return;
    const dayMs = Math.max(1, Number(siteSettings.checkin_interval_hours || 24)) * 3600000, lastMs = Number(currentUser.last_checkin_ms || 0), elapsed = Date.now() - lastMs;
    const needsPlan = siteSettings.checkin_requires_vip !== "0" && Number(currentUser.vip_level || 0) <= 0;
    const off = Number(siteSettings.checkin_reward || 0) <= 0 || siteSettings.checkin_enabled === "0";
    if (lastMs && elapsed < dayMs) {
      const rem = Math.max(0, Math.floor((dayMs - elapsed) / 1000));
      el.textContent = [Math.floor(rem / 3600), Math.floor((rem % 3600) / 60), rem % 60].map((n) => String(n).padStart(2, "0")).join(":");
      btn.disabled = true;
    } else { el.textContent = "00:00:00"; btn.disabled = needsPlan || off; }
  };
  const tick2 = () => { tick(); tickEarn(); };
  tick2(); countdownInterval = setInterval(tick2, 1000);
}

/* ---------- daily earning (member) ---------- */
const DEFAULT_EARN_NOTE = "Earnings are not guaranteed and are paid only from the company's verified payout fund.";
function earnDisclaimer() { return String(siteSettings.earnings_disclaimer || "").trim() || DEFAULT_EARN_NOTE; }
function earnNextAt() {
  const cv = currentVip; if (!cv) return 0;
  const freq = Math.max(1, Number(siteSettings.earnings_frequency_hours || 24)) * 3600000;
  return Math.max(Number(cv.last_earn_ms) || 0, Number(cv.started_at) || 0, Number(cv.earn_start_at) || 0) + freq;
}
function earnState() {
  const cv = currentVip; const now = Date.now();
  if (!cv || siteSettings.earnings_enabled !== "1" || !(Number(cv.daily_usdt) > 0)) return { show: false };
  if (Number(cv.earn_paused)) return { show: true, text: "Paused by administrator", can: false };
  if (Number(cv.earn_start_at) && now < Number(cv.earn_start_at)) return { show: true, text: "Starts " + new Date(Number(cv.earn_start_at)).toLocaleDateString(), can: false };
  if (Number(cv.earn_end_at) && now > Number(cv.earn_end_at)) return { show: true, text: "Earning period ended", can: false };
  if (Number(cv.earn_limit) > 0 && Number(cv.earned_total) >= Number(cv.earn_limit)) return { show: true, text: "Limit reached", can: false };
  const rem = earnNextAt() - now;
  if (rem > 0) return { show: true, text: [Math.floor(rem / 3600000), Math.floor((rem % 3600000) / 60000), Math.floor((rem % 60000) / 1000)].map((n) => String(n).padStart(2, "0")).join(":"), can: false };
  return { show: true, text: siteSettings.earnings_method === "auto" ? "Due — credited automatically" : "Available now", can: siteSettings.earnings_method === "claim" };
}
function renderEarnCard() {
  const cv = currentVip, st = earnState();
  $("prodEarnCard").classList.toggle("hidden", !st.show);
  if (!st.show) return;
  const end = Math.min(Number(cv.expires_at), Number(cv.earn_end_at) || Infinity);
  $("earnDaily").textContent = usdt(cv.daily_usdt);
  $("earnTotal").textContent = usdt(cv.earned_total) + (Number(cv.earn_limit) > 0 ? " / " + usdt(cv.earn_limit) : "");
  $("earnDays").textContent = `${Math.max(0, Math.ceil((end - Date.now()) / 86400000))} Days`;
  $("earnClaimBtn").classList.toggle("hidden", siteSettings.earnings_method !== "claim");
  $("earnNote").textContent = earnDisclaimer();
  tickEarn();
}
function tickEarn() {
  const st = earnState(); if (!st.show || !$("earnNext")) return;
  $("earnNext").textContent = st.text; $("earnClaimBtn").disabled = !st.can;
}
async function claimEarning() {
  $("earnClaimBtn").disabled = true;
  const res = await api("/api/claim-earning", { method: "POST", body: "{}" });
  smartAlert(res.message, res.ok ? "success" : (res.code === "pending" ? "info" : "error"));
  await refreshData();
}

/* ---------- company profile (members) ---------- */
async function loadCompany() {
  const d = await api("/api/company"); const box = $("companyBody");
  if (!d.ok) { box.innerHTML = `<p class="tx-sub">Unable to load.</p>`; return; }
  const p = d.profile || {};
  const sec = (title, text) => String(text || "").trim() ? `<div class="dark-panel neon-green-box"><h3 class="panel-heading">${escapeHtml(title)}</h3><p class="plan-desc">${escapeHtml(text).replace(/\n/g, "<br />")}</p></div>` : "";
  const row = (l, v) => String(v || "").trim() ? `<div class="info-row"><span>${l}</span><strong class="wrap-any">${escapeHtml(v)}</strong></div>` : "";
  const site = /^https:\/\//i.test(p.company_website || "") ? `<div class="info-row"><span>Website</span><a class="wrap-any" href="${escapeHtml(p.company_website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.company_website)}</a></div>` : "";
  const logo = p.company_logo_key ? `<img src="/media/${escapeHtml(p.company_logo_key)}" alt="Company logo" style="max-width:120px;max-height:120px;border-radius:12px;margin-bottom:8px;" />` : "";
  const hasCore = String(p.company_legal_name || "").trim() || String(p.cac_number || "").trim();
  box.innerHTML = `<div class="dark-panel neon-gold-box" style="text-align:center;">${logo}<h3 class="panel-heading">${escapeHtml(p.company_legal_name || siteSettings.company_name || "Company")}</h3></div>
    ${hasCore ? "" : `<div class="dark-panel neon-green-box"><p class="tx-sub">The company has not published its registration details yet.</p></div>`}
    <div class="dark-panel neon-green-box">${row("Registered name", p.company_legal_name)}${row("Company registration no.", p.cac_number)}${row("Address", p.company_address)}${row("Phone", p.company_phone)}${row("E-mail", p.company_email)}${site}${row("Licences / approvals", p.license_info)}</div>
    ${sec("About", p.company_description)}${sec("Mission", p.company_mission)}${sec("Vision", p.company_vision)}${sec("Products & services", p.products_services)}${sec("How we operate", p.how_we_operate)}${sec("How the business earns revenue", p.revenue_model)}${sec("How VIP earnings are funded", p.earnings_funding)}
    ${(d.documents || []).length ? `<div class="dark-panel neon-green-box"><h3 class="panel-heading">Official documents</h3>${d.documents.map((x) => `<div class="tx-row"><div><strong>${escapeHtml(x.title)}</strong></div><a class="mini-action-btn" href="/media/${escapeHtml(x.file_key)}" target="_blank" rel="noopener noreferrer">Open</a></div>`).join("")}</div>` : ""}
    ${p.terms_text ? `<details class="dark-panel neon-green-box"><summary class="panel-heading">Terms and conditions</summary><p class="plan-desc">${escapeHtml(p.terms_text).replace(/\n/g, "<br />")}</p></details>` : ""}
    ${p.privacy_text ? `<details class="dark-panel neon-green-box"><summary class="panel-heading">Privacy policy</summary><p class="plan-desc">${escapeHtml(p.privacy_text).replace(/\n/g, "<br />")}</p></details>` : ""}`;
}

/* ---------- referral rewards (members) ---------- */
function renderRewards() {
  const sum = (st) => commissions.filter((c) => c.status === st).reduce((a, c) => a + Number(c.amount_usdt), 0);
  $("rwPending").textContent = usdt(sum("Pending")); $("rwApproved").textContent = usdt(sum("Approved"));
  const on = siteSettings.referral_enabled === "1";
  $("rwRules").textContent = on ? `Direct referral commission: ${siteSettings.referral_percent}% of the plan price${siteSettings.referral_on_upgrades === "1" ? " (including upgrades)" : " (first purchase only)"}. ${siteSettings.referral_manual_approval !== "0" ? "Each commission is reviewed before crediting. " : ""}Commissions are paid only from the company's verified payout fund and may stay pending if funding is insufficient.` : "Referral rewards are currently disabled.";
  $("rwList").innerHTML = commissions.map((c) => `<div class="tx-row"><div><strong>${escapeHtml(c.referred_name)}</strong><div class="tx-sub">${new Date(Number(c.created_at)).toLocaleDateString()} • ${Number(c.percent)}%${c.note ? " • " + escapeHtml(c.note) : ""}</div></div><div style="text-align:right;">${usdt(c.amount_usdt)}<br>${statusBadge(c.status)}</div></div>`).join("") || `<p class="tx-sub">No referral rewards yet.</p>`;
}

/* ---------- notifications ---------- */
async function loadNotifications() {
  const d = await api("/api/notifications");
  if (!d.ok) return;
  $("notifList").innerHTML = (d.notifications || []).map((n) => `
    <div class="notif-item ${n.is_new ? "is-new" : ""}">
      <div class="notif-title">${n.is_new ? '<span class="new-dot"></span>' : ""}${escapeHtml(n.title)}</div>
      ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ""}
      <div class="tx-sub">${new Date(Number(n.created_at)).toLocaleString()}</div>
    </div>`).join("") || `<p class="tx-sub">No notifications yet.</p>`;
  if (d.notifications?.some((n) => n.is_new)) { await api("/api/notifications/seen", { method: "POST", body: "{}" }); }
  unread = 0; applyBadges();
}

/* ---------- member actions ---------- */
function openDepositBox() { openView("sub-deposit"); }
function goToDeposit() { openDepositBox(); }

async function submitQuickDeposit() {
  const amount = Number($("depositInput").value);
  const proof = $("depositProof").files[0];
  if (!Number.isFinite(amount) || amount <= 0) return smartAlert("Enter the amount you sent.", "error");
  if (!proof) return smartAlert("Please upload your payment screenshot.", "error");
  if (proof.size > 3 * 1024 * 1024) return smartAlert("Screenshot must be 3 MB or smaller.", "error");
  const form = new FormData();
  form.append("amount", String(amount)); form.append("network", siteSettings.deposit_network || "TRC20");
  form.append("tx_reference", $("depositTxRef").value.trim()); form.append("proof", proof);
  const res = await api("/api/deposit", { method: "POST", body: form });
  if (!res.ok) return smartAlert(res.message, "error");
  $("depositInput").value = ""; $("depositTxRef").value = ""; $("depositProof").value = "";
  smartAlert(res.message, "success");
  await refreshData(); goBack();
}
function copyDepositAddress() {
  const v = $("depositAddressLabel").textContent;
  if (!v || v.includes("not configured")) return smartAlert("Deposit wallet has not been configured.", "error");
  copyText(v, "Deposit address copied.");
}
async function buyVip(vip) {
  const plan = plans.find((p) => Number(p.vip_level) === Number(vip));
  if (plan && !confirm(`Activate ${plan.title} for ${usdt(plan.price_usdt)}? This amount will be deducted from your balance.`)) return;
  const res = await api("/api/buy-vip", { method: "POST", body: JSON.stringify({ vip }) });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await refreshData(); openPlan(vip); viewStack.pop(); // refresh the detail page in place
}
async function claimDailyReward() {
  const res = await api("/api/checkin", { method: "POST", body: "{}" });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success"); await refreshData();
}
function copyText(text, okMsg) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => smartAlert(okMsg, "success")).catch(() => smartAlert("Could not copy.", "error"));
  else smartAlert("Copy is not supported in this browser.", "error");
}
function copyMemberId() { copyText($("homeMemberId").textContent, "Member ID copied."); }
function copyReferralLink() { copyText($("referralLinkInput").value, "Referral link copied!"); }
function shareReferral(channel) {
  const link = encodeURIComponent($("referralLinkInput").value), text = encodeURIComponent("Join me on Prime Digital Finance (PDF): ");
  window.open(channel === "whatsapp" ? `https://wa.me/?text=${text}${link}` : `https://t.me/share/url?url=${link}&text=${text}`, "_blank", "noopener,noreferrer");
}
function toggleFaqBox() { $("faqPanel").classList.toggle("hidden"); }

async function saveWalletAddress() {
  const res = await api("/api/payment-method", { method: "POST", body: JSON.stringify({ wallet_network: $("walletNetwork").value, wallet_address: $("walletAddress").value.trim() }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await refreshData();
}
async function saveSecurityPin() {
  const pin = $("newPin").value;
  if (!/^\d{4}$/.test(pin)) return smartAlert("PIN must be exactly 4 digits.", "error");
  const res = await api("/api/security-pin", { method: "POST", body: JSON.stringify({ pin }) });
  if (res.ok) { $("newPin").value = ""; await refreshData(); }
  smartAlert(res.message, res.ok ? "success" : "error");
}
async function submitWithdrawal() {
  const amount = Number($("withdrawAmount").value);
  if (!Number.isFinite(amount) || amount <= 0) return smartAlert("Enter a valid amount.", "error");
  const res = await api("/api/withdraw", { method: "POST", body: JSON.stringify({ amount, pin: $("withdrawPin").value }) });
  $("withdrawPin").value = "";
  if (!res.ok) return smartAlert(res.message, "error");
  $("withdrawAmount").value = "";
  smartAlert(res.message, "success"); await refreshData(); goBack();
}
async function submitPasswordChange() {
  const cur = $("pwCurrent").value, next = $("pwNew").value, conf = $("pwConfirm").value;
  if (next.length < 8) return smartAlert("New password must be at least 8 characters.", "error");
  if (next !== conf) return smartAlert("The new passwords do not match.", "error");
  const res = await api("/api/change-password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: next }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("pwCurrent").value = $("pwNew").value = $("pwConfirm").value = ""; await refreshData(); goBack(); }
}
async function logoutAllDevices() {
  if (!confirm("Sign out of all devices, including this one?")) return;
  await api("/api/logout-all", { method: "POST", body: "{}" });
  setToken(""); location.reload();
}

/* ---------- admin ---------- */
const SETTING_FIELDS = { cfgCompanyName: "company_name", cfgBrandShort: "brand_short", cfgTagline: "tagline", cfgHeroTitle: "hero_title", cfgHeroSubtitle: "hero_subtitle", cfgAnnouncement: "announcement", cfgFaq: "faq_text", cfgDepositAddress: "deposit_address", cfgDepositNetwork: "deposit_network", cfgDepositMin: "deposit_min", cfgDepositMax: "deposit_max", cfgWithdrawMin: "withdraw_min", cfgWithdrawMax: "withdraw_max", cfgWithdrawFee: "withdraw_fee", cfgCheckinReward: "checkin_reward", cfgCheckinInterval: "checkin_interval_hours", cfgDepositInstructions: "deposit_instructions", cfgRegistrationOpen: "registration_open", cfgCheckinRequiresVip: "checkin_requires_vip", cfgDepositsEnabled: "deposits_enabled", cfgWithdrawalsEnabled: "withdrawals_enabled", cfgVipEnabled: "vip_purchases_enabled", cfgCheckinEnabled: "checkin_enabled", cfgMaintenance: "maintenance_mode", cfgMaintenanceMsg: "maintenance_message", cfgLegalName: "company_legal_name", cfgCac: "cac_number", cfgCompanyAddress: "company_address", cfgCompanyPhone: "company_phone", cfgCompanyEmail: "company_email", cfgCompanyWebsite: "company_website", cfgCompanyDesc: "company_description", cfgMission: "company_mission", cfgVision: "company_vision", cfgProducts: "products_services", cfgHowOperate: "how_we_operate", cfgRevenueModel: "revenue_model", cfgEarningsFunding: "earnings_funding", cfgLicense: "license_info", cfgTerms: "terms_text", cfgPrivacy: "privacy_text", cfgEarningsEnabled: "earnings_enabled", cfgEarningsMethod: "earnings_method", cfgEarningsFreq: "earnings_frequency_hours", cfgEarnDisclaimer: "earnings_disclaimer", cfgReferralEnabled: "referral_enabled", cfgReferralPercent: "referral_percent", cfgReferralManual: "referral_manual_approval", cfgReferralUpgrades: "referral_on_upgrades", cfgLiveChat: "live_chat_url", cfgTelegram: "telegram_url", cfgWhatsapp: "whatsapp_url" };
const SETTING_GROUPS = {
  site: ["cfgCompanyName", "cfgBrandShort", "cfgTagline", "cfgHeroTitle", "cfgHeroSubtitle", "cfgAnnouncement", "cfgFaq"],
  pay: ["cfgDepositAddress", "cfgDepositNetwork", "cfgDepositMin", "cfgDepositMax", "cfgWithdrawMin", "cfgWithdrawMax", "cfgWithdrawFee", "cfgCheckinReward", "cfgCheckinInterval", "cfgDepositInstructions", "cfgCheckinRequiresVip"],
  global: ["cfgRegistrationOpen", "cfgDepositsEnabled", "cfgWithdrawalsEnabled", "cfgVipEnabled", "cfgCheckinEnabled", "cfgMaintenance", "cfgMaintenanceMsg"],
  company: ["cfgLegalName", "cfgCac", "cfgCompanyAddress", "cfgCompanyPhone", "cfgCompanyEmail", "cfgCompanyWebsite", "cfgCompanyDesc", "cfgMission", "cfgVision", "cfgProducts", "cfgHowOperate", "cfgRevenueModel", "cfgEarningsFunding", "cfgLicense", "cfgTerms", "cfgPrivacy"],
  earn: ["cfgEarningsEnabled", "cfgEarningsMethod", "cfgEarningsFreq", "cfgEarnDisclaimer"],
  ref: ["cfgReferralEnabled", "cfgReferralPercent", "cfgReferralManual", "cfgReferralUpgrades"],
  links: ["cfgLiveChat", "cfgTelegram", "cfgWhatsapp"]
};
const fmtDate = (ms) => Number(ms) ? new Date(Number(ms)).toLocaleString() : "—";
const dayStart = (id) => { const v = $(id)?.value; return v ? new Date(v + "T00:00:00").getTime() : 0; };
const dayEnd = (id) => { const v = $(id)?.value; return v ? new Date(v + "T23:59:59.999").getTime() : 0; };
function qs(params) { const p = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; }
function chipValue(id) { return document.querySelector(`#${id}Chips .chip.active`)?.dataset.f || ""; }
document.addEventListener("click", (e) => {
  const c = e.target.closest(".chip-row .chip"); if (!c || c.closest("#historyChips")) return;
  const row = c.parentElement; row.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
  const fn = { commChips: loadCommissions, depChips: loadAdminDeposits, wdChips: loadAdminWithdrawals, purChips: loadAdminPurchases }[row.id]; if (fn) fn();
});
function statusBadge(s) { return `<span class="st-badge ${escapeHtml(s)}">${escapeHtml(s)}</span>`; }

async function loadAdminOverview() {
  if (!currentUser || !currentUser.is_super_admin) return;
  const d = await api("/api/admin/overview");
  if (!d.ok) return smartAlert(d.message, "error");
  window.__adminPlans = d.plans || [];
  adminPending = d.pending; applyBadges();
  const cfg = d.settings || {};
  for (const [id, key] of Object.entries(SETTING_FIELDS)) { const el = $(id); if (el && document.activeElement !== el) el.value = cfg[key] ?? ""; }
  $("adminPlansContainer").innerHTML = window.__adminPlans.map((p, idx) => `
    <div class="tx-row"><div><strong>${escapeHtml(p.title)} (Level ${Number(p.vip_level)})</strong> ${Number(p.is_active) ? statusBadge("Approved").replace("Approved", "Active") : '<span class="st-badge Rejected">Inactive</span>'}<div class="tx-sub">${usdt(p.price_usdt)} • ${Number(p.duration_days)} days${Number(p.daily_usdt) > 0 ? " • earning " + usdt(p.daily_usdt) + "/period" : ""}</div></div>
    <div class="tx-btns"><button type="button" class="mini-action-btn" onclick="editAdminPlan(${idx})">Edit</button><button type="button" class="mini-action-btn" onclick="togglePlan(${idx})">${Number(p.is_active) ? "Deactivate" : "Activate"}</button><button type="button" class="mini-action-btn" onclick="deleteAdminPlan(${Number(p.vip_level)})">Delete</button></div></div>`).join("") || `<p class="tx-sub">No plans yet. Add your first plan above.</p>`;
  if (!$("adminPlanLevel").value) $("adminPlanLevel").value = Math.max(0, ...window.__adminPlans.map((p) => Number(p.vip_level))) + 1;
  window.__adminAccounts = d.super_admins || [];
  $("superAdminsContainer").innerHTML = window.__adminAccounts.map((a, idx) => `<div class="tx-row"><div><strong>${escapeHtml(a.email)}</strong><div class="tx-sub">Added by: ${escapeHtml(a.added_by)}</div></div><div class="tx-btns"><span class="st-badge Approved">${escapeHtml(a.role)}</span>${a.email.toLowerCase() !== currentUser.email.toLowerCase() ? `<button type="button" class="mini-action-btn" onclick="removeSuperAdminAt(${idx})">Remove</button>` : ""}</div></div>`).join("");
  $("adminNotifList").innerHTML = (d.notifications || []).map((n) => `<div class="tx-row"><div><strong>${escapeHtml(n.title)}</strong><div class="tx-sub">${escapeHtml(n.body || "")}</div><div class="tx-sub">${n.user_email ? escapeHtml(n.user_email) : "All members"} • ${fmtDate(n.created_at)}</div></div><button type="button" class="mini-action-btn" onclick="deleteAdminNotification(${Number(n.id)})">Delete</button></div>`).join("") || `<p class="tx-sub">Nothing sent yet.</p>`;
}

/* dashboard */
function statCard(icon, num, title, theme = "theme-green") { return `<div class="color-stat-card ${theme}"><div class="stat-icon-circle">${icon}</div><div class="stat-card-num">${escapeHtml(num)}</div><div class="stat-card-title">${escapeHtml(title)}</div></div>`; }
async function loadDashboard() {
  const d = await api(`/api/admin/dashboard${qs({ from: dayStart("dashFrom"), to: dayEnd("dashTo") })}`);
  if (!d.ok) return smartAlert(d.message, "error");
  const g = (o, k) => o[k] || { count: 0, total: 0 };
  $("dashCards").innerHTML = [
    statCard("👥", d.users.total, "Registered users"), statCard("✅", d.users.active, "Active users", "theme-blue"), statCard("⛔", d.users.suspended, "Suspended", "theme-purple"),
    statCard("💰", usdt(d.balances_total), "Total balances"),
    statCard("📥", `${g(d.deposits, "Approved").count} • ${usdt(g(d.deposits, "Approved").total)}`, "Approved deposits", "theme-blue"),
    statCard("⏳", g(d.deposits, "Pending").count, "Pending deposits", "theme-purple"), statCard("🚫", g(d.deposits, "Rejected").count, "Rejected deposits"),
    statCard("📤", `${g(d.withdrawals, "Approved").count} • ${usdt(g(d.withdrawals, "Approved").total)}`, "Approved withdrawals", "theme-blue"),
    statCard("⏳", g(d.withdrawals, "Pending").count, "Pending withdrawals", "theme-purple"),
    statCard("👑", d.vip.active, "Active VIP"), statCard("⌛", d.vip.expired, "Expired VIP", "theme-blue"),
    statCard("🧾", `${d.vip.purchases.count} • ${usdt(d.vip.purchases.total)}`, "VIP purchases", "theme-purple"),
    statCard("⬆️", `${d.vip.upgrades.count} • ${usdt(d.vip.upgrades.total)}`, "VIP upgrades"),
    statCard("🔗", d.direct_referrals, "Invited sign-ups", "theme-blue"),
    statCard("🎁", `${d.checkins.count} • ${usdt(d.checkins.total)}`, "Check-in claims", "theme-purple")
  ].join("");
  $("dashRecent").innerHTML = (d.recent_transactions || []).map((t) => `<div class="tx-row"><div><strong>${escapeHtml(t.type)}</strong><div class="tx-sub wrap-any">${escapeHtml(t.user_email)} • ${fmtDate(t.created_at)}</div></div><div style="text-align:right;">${usdt(t.amount_usdt)}<br>${statusBadge(t.status)}</div></div>`).join("") || `<p class="tx-sub">No transactions yet.</p>`;
  $("dashAlerts").innerHTML = (d.alerts || []).map((a) => `<div class="tx-row"><div><strong>${escapeHtml(a.level)}</strong><div class="tx-sub wrap-any">${escapeHtml(a.message)} • ${fmtDate(a.created_at)}</div></div></div>`).join("") || `<p class="tx-sub">No alerts. ✓</p>`;
}

/* users */
function renderAdminUsers(list) {
  window.__adminUsers = list;
  $("adminMembersContainer").innerHTML = list.map((u, idx) => `
    <div class="tx-row" role="button" tabindex="0" onclick="openUserDetail(${idx})">
      <div><strong>${escapeHtml(u.fullname)}</strong> ${u.is_banned ? '<span class="st-badge Rejected">Suspended</span>' : ""} ${u.withdraw_frozen ? '<span class="st-badge Pending">Withdrawals frozen</span>' : ""}
        <div class="tx-sub wrap-any">${escapeHtml(u.custom_id)} • ${escapeHtml(u.email)}${u.phone ? " • " + escapeHtml(u.phone) : ""}</div>
        <div class="tx-sub">Balance: ${usdt(u.balance_usdt)} • VIP ${Number(u.vip_level) > 0 && Number(u.vip_expires_at) > Date.now() ? Number(u.vip_level) : 0}</div></div>
      <span class="menu-arrow">›</span>
    </div>`).join("") || `<p class="tx-sub">No members found.</p>`;
}
async function searchAdminUsers() {
  const d = await api(`/api/admin/users${qs({ q: $("adminUserSearch").value.trim() })}`);
  if (!d.ok) return smartAlert(d.message, "error");
  renderAdminUsers(d.users || []);
}
function openUserDetail(idx) { const u = (window.__adminUsers || [])[idx]; if (!u) return; window.__udEmail = u.email; openView("adm-user"); loadUserDetail(); }
async function loadUserDetail() {
  const d = await api(`/api/admin/user-detail?email=${encodeURIComponent(window.__udEmail || "")}`);
  if (!d.ok) return smartAlert(d.message, "error");
  const u = d.user; window.__udUser = u;
  const vipOn = Number(u.vip_level) > 0 && Number(u.vip_expires_at) > Date.now();
  $("userDetailHead").innerHTML = `<h3 class="panel-heading">${escapeHtml(u.fullname)}</h3>
    <div class="info-row"><span>Member ID</span><strong>${escapeHtml(u.custom_id)}</strong></div>
    <div class="info-row"><span>Email</span><strong class="wrap-any">${escapeHtml(u.email)}</strong></div>
    <div class="info-row"><span>Phone</span><strong>${escapeHtml(u.phone || "—")}</strong></div>
    <div class="info-row"><span>Balance</span><strong>${usdt(u.balance_usdt)}</strong></div>
    <div class="info-row"><span>Current VIP</span><strong>${vipOn ? "VIP " + Number(u.vip_level) + " until " + new Date(Number(u.vip_expires_at)).toLocaleDateString() : "None"}</strong></div>
    <div class="info-row"><span>Referral code</span><strong>${escapeHtml(u.custom_id)}</strong></div>
    <div class="info-row"><span>Invited by</span><strong>${d.referrer ? escapeHtml(d.referrer.fullname) + " (" + escapeHtml(d.referrer.custom_id) + ")" : "—"}</strong></div>
    <div class="info-row"><span>Joined</span><strong>${fmtDate(u.created_at)}</strong></div>
    <div class="info-row"><span>Last login</span><strong>${fmtDate(u.last_login_at)}</strong></div>
    <div class="info-row"><span>Check-ins</span><strong>${Number(u.checkin_count || 0)}</strong></div>
    <div class="info-row"><span>Status</span><strong>${Number(u.is_banned) ? "Suspended" : "Active"}${Number(u.withdraw_frozen) ? " • withdrawals frozen" : ""}</strong></div>`;
  $("udNote").value = u.admin_note || "";
  const btn = (a, l) => `<button type="button" class="mini-action-btn" onclick="userAct('${a}')">${l}</button>`;
  $("udActions").innerHTML = (Number(u.is_banned) ? btn("unban", "Re-activate") : btn("ban", "Suspend")) + (Number(u.withdraw_frozen) ? btn("unfreeze-withdrawals", "Unfreeze withdrawals") : btn("freeze-withdrawals", "Freeze withdrawals")) + btn("reset-pin", "Clear PIN");
  $("udVip").innerHTML = (d.vip_history || []).map((v) => `<div class="tx-row"><div><strong>${escapeHtml(v.plan_title)}</strong> <span class="tx-sub">(${escapeHtml(v.kind)})</span><div class="tx-sub">${fmtDate(v.started_at)} → ${fmtDate(v.expires_at)}</div></div><div style="text-align:right;">${usdt(v.price_usdt)}<br>${statusBadge(v.status === "active" && Number(v.expires_at) <= Date.now() ? "expired" : v.status)}</div></div>`).join("") || `<p class="tx-sub">No VIP history.</p>`;
  $("udDeps").innerHTML = (d.deposits || []).map((x) => `<div class="tx-row"><div><strong>#${Number(x.id)} • ${usdt(x.amount_usdt)}</strong><div class="tx-sub wrap-any">${escapeHtml(x.tx_reference || "no reference")} • ${fmtDate(x.created_at)}</div></div>${statusBadge(x.status)}</div>`).join("") || `<p class="tx-sub">No deposits.</p>`;
  $("udInvited").innerHTML = (d.invited || []).map((m) => `<div class="tx-row"><div><strong>${escapeHtml(m.fullname)}</strong><div class="tx-sub">${escapeHtml(m.custom_id)} • ${new Date(Number(m.created_at)).toLocaleDateString()}</div></div><span class="tx-sub">${m.purchased ? "Bought a plan" : "No plan yet"}</span></div>`).join("") || `<p class="tx-sub">Nobody invited yet.</p>`;
  $("udTx").innerHTML = (d.transactions || []).map((t) => `<div class="tx-row"><div><strong>${escapeHtml(t.type)}</strong><div class="tx-sub wrap-any">${escapeHtml(t.details || "")} • ${fmtDate(t.created_at)}</div></div><div style="text-align:right;">${t.type === "Account Activity" ? "" : usdt(t.amount_usdt) + "<br>" + statusBadge(t.status)}</div></div>`).join("") || `<p class="tx-sub">No transactions.</p>`;
}
async function userAct(action) {
  const labels = { ban: "Suspend", unban: "Re-activate", "freeze-withdrawals": "Freeze withdrawals for", "unfreeze-withdrawals": "Unfreeze withdrawals for", "reset-pin": "Clear the transaction PIN of" };
  if (!confirm(`${labels[action]} ${window.__udEmail}?`)) return;
  const res = await api("/api/admin/user-action", { method: "POST", body: JSON.stringify({ email: window.__udEmail, action, reason: $("udReason").value }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) loadUserDetail();
}
async function saveUserNote() {
  const res = await api("/api/admin/user-action", { method: "POST", body: JSON.stringify({ email: window.__udEmail, action: "save-note", note: $("udNote").value }) });
  smartAlert(res.message, res.ok ? "success" : "error");
}
async function submitAdjust() {
  const type = $("adjType").value, amount = Number($("adjAmount").value), reason = $("adjReason").value.trim();
  const u = window.__udUser; if (!u) return;
  if (!(amount > 0)) return smartAlert("Enter an amount.", "error");
  if (reason.length < 5) return smartAlert("Enter a reason (at least 5 characters).", "error");
  const prev = Number(u.balance_usdt), next = type === "credit" ? prev + amount : prev - amount;
  if (!confirm(`${type === "credit" ? "CREDIT" : "DEBIT"} ${amount.toFixed(2)} USDT\n${u.email}\nPrevious balance: ${prev.toFixed(2)}\nNew balance: ${next.toFixed(2)}\nReason: ${reason}\n\nConfirm?`)) return;
  const res = await api("/api/admin/adjust-balance", { method: "POST", body: JSON.stringify({ email: u.email, type, amount, reason, confirm: true }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("adjAmount").value = ""; $("adjReason").value = ""; loadUserDetail(); }
}

/* deposits / withdrawals / purchases / audit */
const listParams = (id) => ({ q: $(id + "Q").value.trim(), status: chipValue(id), kind: chipValue(id), from: dayStart(id + "From"), to: dayEnd(id + "To") });
async function loadAdminDeposits() {
  const d = await api(`/api/admin/deposits${qs(listParams("dep"))}`);
  if (!d.ok) return smartAlert(d.message, "error");
  $("depList").innerHTML = (d.deposits || []).map((x) => `<div class="admin-review-row"><strong>Deposit #${Number(x.id)} • ${escapeHtml(x.user_email)}</strong> ${statusBadge(x.status)}<div class="tx-sub">${usdt(x.amount_usdt)} • ${escapeHtml(x.network)} • ${fmtDate(x.created_at)}</div><div class="tx-sub wrap-any">Reference: ${escapeHtml(x.tx_reference || "Not supplied")}</div>${x.admin_note ? `<div class="tx-sub">Note: ${escapeHtml(x.admin_note)}</div>` : ""}<div id="proof-${Number(x.id)}" class="tx-sub"><button type="button" class="mini-action-btn" onclick="loadDepositProof(${Number(x.id)})">View payment proof</button></div>${x.status === "Pending" ? `<input id="deposit-note-${Number(x.id)}" placeholder="Optional review note" /><div class="admin-review-actions"><button type="button" class="approve" onclick="reviewDeposit(${Number(x.id)},'Approved')">Approve &amp; Credit</button><button type="button" class="reject" onclick="reviewDeposit(${Number(x.id)},'Rejected')">Reject</button></div>` : ""}</div>`).join("") || `<p class="tx-sub">No deposits found.</p>`;
}
async function loadAdminWithdrawals() {
  const d = await api(`/api/admin/withdrawals${qs(listParams("wd"))}`);
  if (!d.ok) return smartAlert(d.message, "error");
  $("wdList").innerHTML = (d.withdrawals || []).map((w) => `<div class="admin-review-row"><strong>#${Number(w.id)} • ${escapeHtml(w.user_email)}</strong> ${statusBadge(w.status)}<div class="tx-sub">${usdt(w.amount_usdt)} • ${fmtDate(w.created_at)}</div><div class="tx-sub wrap-any">${escapeHtml(w.details || "")}</div>${w.status === "Pending" ? `<input id="wd-note-${Number(w.id)}" placeholder="Optional review note" /><div class="admin-review-actions"><button type="button" class="approve" onclick="decideWithdrawal(${Number(w.id)},'Approved')">Approve</button><button type="button" class="reject" onclick="decideWithdrawal(${Number(w.id)},'Rejected')">Reject &amp; refund</button></div>` : ""}</div>`).join("") || `<p class="tx-sub">No withdrawals found.</p>`;
}
async function loadAdminPurchases() {
  const p = listParams("pur"); delete p.status;
  const d = await api(`/api/admin/purchases${qs(p)}`);
  if (!d.ok) return smartAlert(d.message, "error");
  $("purList").innerHTML = (d.purchases || []).map((v) => `<div class="tx-row"><div><strong>${escapeHtml(v.plan_title)}</strong> <span class="tx-sub">(${escapeHtml(v.kind)})</span><div class="tx-sub wrap-any">${escapeHtml(v.user_email)}</div><div class="tx-sub">${fmtDate(v.started_at)} → ${fmtDate(v.expires_at)}</div></div><div style="text-align:right;">${usdt(v.price_usdt)}<br>${statusBadge(v.status)}</div></div>`).join("") || `<p class="tx-sub">No purchases found.</p>`;
}
async function loadAudit() {
  const d = await api(`/api/admin/audit${qs({ q: $("auditQ").value.trim() })}`);
  if (!d.ok) return smartAlert(d.message, "error");
  $("auditList").innerHTML = (d.entries || []).map((e) => `<div class="tx-row"><div><strong>${escapeHtml(e.action)}</strong><div class="tx-sub wrap-any">By ${escapeHtml(e.actor)} • ${escapeHtml(e.target)} • ${fmtDate(e.created_at)}</div>${e.reason ? `<div class="tx-sub">Reason: ${escapeHtml(e.reason)}</div>` : ""}<div class="tx-sub wrap-any">${escapeHtml(e.details)}</div></div></div>`).join("") || `<p class="tx-sub">No audit entries.</p>`;
}
async function loadHealth() {
  const d = await api("/api/admin/health");
  if (!d.ok) return smartAlert(d.message, "error");
  window.__health = d;
  const ok = (v) => (v === "ok" ? "✅ ok" : "⚠️ " + escapeHtml(v));
  $("healthBox").innerHTML = `<div class="info-row"><span>Version</span><strong>${escapeHtml(d.version)}</strong></div><div class="info-row"><span>Worker/API</span><strong>${ok(d.worker)}</strong></div><div class="info-row"><span>Database</span><strong>${ok(d.checks.database)}</strong></div><div class="info-row"><span>R2 storage</span><strong>${ok(d.checks.storage)}</strong></div><div class="info-row"><span>Audit log protected</span><strong>${d.audit_protected ? "✅ yes" : "⚠️ triggers missing"}</strong></div><div class="info-row"><span>Last 24h</span><strong>${Object.entries(d.last_24h).map(([k, v]) => k + ": " + v).join(", ") || "no events"}</strong></div><div class="info-row"><span>Tables</span><strong class="wrap-any">${Object.entries(d.tables).map(([k, v]) => k + " " + v).join(" • ")}</strong></div><p class="tx-sub">${escapeHtml(d.backup)}</p>`;
  $("healthEvents").innerHTML = (d.events || []).map((a) => `<div class="tx-row"><div><strong>${escapeHtml(a.level)}</strong><div class="tx-sub wrap-any">${escapeHtml(a.message)} • ${fmtDate(a.created_at)}</div></div></div>`).join("") || `<p class="tx-sub">No events.</p>`;
}
function exportDiagnostics() {
  if (!window.__health) return smartAlert("Open System Health first.", "error");
  const blob = new Blob([JSON.stringify(window.__health, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `pdf-diagnostics-${Date.now()}.json`; a.click();
}

/* company (admin) */
async function loadAdminCompanyDocs() {
  const d = await api("/api/company"); if (!d.ok) return;
  $("adminCompanyDocs").innerHTML = (d.documents || []).map((x) => `<div class="tx-row"><div><strong>${escapeHtml(x.title)}</strong><div class="tx-sub">${fmtDate(x.created_at)}</div></div><div class="tx-btns"><a class="mini-action-btn" href="/media/${escapeHtml(x.file_key)}" target="_blank" rel="noopener noreferrer">Open</a><button type="button" class="mini-action-btn" onclick="deleteCompanyDoc(${Number(x.id)})">Remove</button></div></div>`).join("") || `<p class="tx-sub">No documents published.</p>`;
}
async function uploadCompanyLogo() {
  const file = $("companyLogoFile").files[0]; if (!file) return smartAlert("Choose a logo first.", "error");
  const form = new FormData(); form.append("kind", "logo"); form.append("file", file);
  const res = await api("/api/admin/company-file", { method: "POST", body: form });
  smartAlert(res.message, res.ok ? "success" : "error"); if (res.ok) $("companyLogoFile").value = "";
}
async function uploadCompanyDoc() {
  const file = $("companyDocFile").files[0]; if (!file) return smartAlert("Choose a document first.", "error");
  const form = new FormData(); form.append("kind", "document"); form.append("title", $("companyDocTitle").value); form.append("file", file);
  const res = await api("/api/admin/company-file", { method: "POST", body: form });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("companyDocFile").value = ""; $("companyDocTitle").value = ""; loadAdminCompanyDocs(); }
}
async function deleteCompanyDoc(id) {
  if (!confirm("Remove this document from the public company profile?")) return;
  const res = await api("/api/admin/company-doc-delete", { method: "POST", body: JSON.stringify({ id }) });
  smartAlert(res.message, res.ok ? "success" : "error"); if (res.ok) loadAdminCompanyDocs();
}

/* earnings (admin) */
async function loadEarnings() {
  const d = await api(`/api/admin/earnings${qs({ q: $("earnQ")?.value.trim() })}`);
  if (!d.ok) return smartAlert(d.message, "error");
  window.__ledger = d.ledger || [];
  $("earnCompliance").innerHTML = d.missing.length
    ? `<h3 class="panel-heading">⛔ Payouts locked</h3><p class="tx-sub">Daily earnings and referral commissions cannot be enabled until the Company Profile has:</p>${d.missing.map((m) => `<div class="tx-sub">• ${escapeHtml(m)}</div>`).join("")}`
    : `<h3 class="panel-heading">✅ Documentation complete</h3><p class="tx-sub">Payouts may be enabled. The payout fund must still hold verified revenue before anything is credited.</p>`;
  $("earnStats").innerHTML = `<div class="info-row"><span>Payout fund balance</span><strong>${usdt(d.pool)}</strong></div><div class="info-row"><span>Revenue allocated</span><strong>${usdt(d.allocated)}</strong></div><div class="info-row"><span>Earnings paid</span><strong>${usdt(d.paid_earnings)} (${d.earning_credits} credits)</strong></div><div class="info-row"><span>Commissions paid</span><strong>${usdt(d.paid_commissions)}</strong></div>`;
  $("earnSchedules").innerHTML = (d.schedules || []).map((x) => `<div class="tx-row"><div><strong class="wrap-any">${escapeHtml(x.user_email)}</strong><div class="tx-sub">${escapeHtml(x.plan_title)} • ${usdt(x.daily_usdt)}/period • received ${usdt(x.earned_total)}${Number(x.earn_limit) > 0 ? " / " + usdt(x.earn_limit) : ""}${Number(x.earn_paused) ? " • PAUSED" : ""}</div></div><button type="button" class="mini-action-btn" onclick="pauseSchedule(${Number(x.id)},${Number(x.earn_paused) ? "false" : "true"})">${Number(x.earn_paused) ? "Resume" : "Pause"}</button></div>`).join("") || `<p class="tx-sub">No active schedules.</p>`;
  $("earnLedger").innerHTML = (d.ledger || []).map((l) => `<div class="tx-row"><div><strong>${escapeHtml(l.kind)}</strong><div class="tx-sub wrap-any">${escapeHtml(l.note)} • ${escapeHtml(l.actor)} • ${fmtDate(l.created_at)}</div></div><strong>${Number(l.amount) > 0 ? "+" : ""}${Number(l.amount).toFixed(2)}</strong></div>`).join("") || `<p class="tx-sub">Ledger is empty.</p>`;
}
async function submitAllocation() {
  const amount = Number($("fundAmount").value), reference = $("fundRef").value.trim(), note = $("fundNote").value.trim();
  if (!(amount > 0) || reference.length < 3 || note.length < 5) return smartAlert("Enter the amount, a document reference and a source description.", "error");
  if (!confirm(`Allocate ${amount.toFixed(2)} USDT of VERIFIED company revenue to the payout fund?\nReference: ${reference}`)) return;
  const res = await api("/api/admin/fund-allocation", { method: "POST", body: JSON.stringify({ amount, reference, note, confirm: true }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("fundAmount").value = $("fundRef").value = $("fundNote").value = ""; loadEarnings(); }
}
async function submitCorrection() {
  const amount = Number($("corrAmount").value), reason = $("corrReason").value.trim();
  if (!amount || reason.length < 5) return smartAlert("Enter a non-zero amount and a reason.", "error");
  if (!confirm(`Record an accounting correction of ${amount.toFixed(2)} USDT on the payout fund?`)) return;
  const res = await api("/api/admin/ledger-correction", { method: "POST", body: JSON.stringify({ amount, reason, confirm: true }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("corrAmount").value = $("corrReason").value = ""; loadEarnings(); }
}
async function pauseSchedule(purchaseId, paused) {
  const reason = prompt(paused ? "Reason for pausing this earning schedule:" : "Reason for resuming:"); if (!reason) return;
  const res = await api("/api/admin/pause-earning", { method: "POST", body: JSON.stringify({ purchaseId, paused, reason }) });
  smartAlert(res.message, res.ok ? "success" : "error"); if (res.ok) loadEarnings();
}
async function runAutoEarnings() {
  if (!confirm("Process all due automatic earnings now?")) return;
  const res = await api("/api/admin/run-earnings", { method: "POST", body: "{}" });
  smartAlert(res.message, res.ok ? "success" : "error"); loadEarnings();
}
function exportLedger() {
  const rows = [["id", "kind", "amount", "note", "actor", "created_at"], ...(window.__ledger || []).map((l) => [l.id, l.kind, l.amount, l.note, l.actor, new Date(Number(l.created_at)).toISOString()])];
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `ledger-${Date.now()}.csv`; a.click();
}

/* commissions (admin) */
async function loadCommissions() {
  const d = await api(`/api/admin/commissions${qs({ q: $("commQ").value.trim(), status: chipValue("comm") })}`);
  if (!d.ok) return smartAlert(d.message, "error");
  $("commList").innerHTML = (d.commissions || []).map((c) => `<div class="admin-review-row"><strong>#${Number(c.id)} • ${usdt(c.amount_usdt)} (${Number(c.percent)}% of ${usdt(c.base_usdt)})</strong> ${statusBadge(c.status)}<div class="tx-sub wrap-any">Referrer: ${escapeHtml(c.referrer_email)}</div><div class="tx-sub wrap-any">Referred: ${escapeHtml(c.referred_email)} • ${escapeHtml(c.plan_title || "")} (${escapeHtml(c.kind || "")}) • ${fmtDate(c.created_at)}</div>${c.note ? `<div class="tx-sub">Note: ${escapeHtml(c.note)}</div>` : ""}${c.status === "Pending" ? `<input id="comm-note-${Number(c.id)}" placeholder="Note (required to reject)" /><div class="admin-review-actions"><button type="button" class="approve" onclick="commissionAct(${Number(c.id)},'Approved')">Approve &amp; credit</button><button type="button" class="reject" onclick="commissionAct(${Number(c.id)},'Rejected')">Reject</button></div>` : ""}</div>`).join("") || `<p class="tx-sub">No commissions found.</p>`;
}
async function commissionAct(id, decision) {
  if (!confirm(decision === "Approved" ? `Approve commission #${id} and credit it from the payout fund?` : `Reject commission #${id}?`)) return;
  const res = await api("/api/admin/commission-action", { method: "POST", body: JSON.stringify({ id, decision, note: $(`comm-note-${id}`)?.value || "" }) });
  smartAlert(res.message, res.ok ? "success" : "error"); loadCommissions();
}

async function loadDepositProof(id) {
  const box = $(`proof-${id}`); if (box) box.textContent = "Loading payment proof…";
  try {
    const res = await fetch(`/api/admin/deposit-proof/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error();
    const url = URL.createObjectURL(await res.blob());
    if (box) box.innerHTML = `<img src="${url}" alt="Payment proof for deposit ${id}" />`;
  } catch { if (box) box.textContent = "Unable to load proof image."; }
}
async function reviewDeposit(requestId, decision) {
  if (!confirm(decision === "Approved" ? `Approve deposit #${requestId} and credit the member?` : `Reject deposit #${requestId}?`)) return;
  const note = $(`deposit-note-${requestId}`)?.value || "";
  const res = await api("/api/admin/deposit-action", { method: "POST", body: JSON.stringify({ requestId, decision, note }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminDeposits(); await loadAdminOverview(); }
}
async function decideWithdrawal(txId, decision) {
  if (!confirm(`${decision === "Approved" ? "Approve" : "Reject"} withdrawal #${txId}? ${decision === "Approved" ? "Make sure you have sent the USDT first." : "The amount will be refunded to the member."}`)) return;
  const res = await api("/api/admin/withdrawal-action", { method: "POST", body: JSON.stringify({ txId, decision, note: $(`wd-note-${txId}`)?.value || "" }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminWithdrawals(); await loadAdminOverview(); }
}
async function savePlatformSettings(group) {
  const body = {};
  for (const id of SETTING_GROUPS[group] || []) body[SETTING_FIELDS[id]] = $(id).value;
  if (group === "global" && body.maintenance_mode === "1" && !confirm("Turn ON maintenance mode? Members will be blocked until you turn it off.")) return;
  const res = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await refreshData(); }
}
async function uploadHomeBanner() {
  const file = $("cfgBannerFile").files[0];
  if (!file) return smartAlert("Choose a banner image first.", "error");
  const form = new FormData(); form.append("banner", file);
  const res = await api("/api/admin/banner", { method: "POST", body: form });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("cfgBannerFile").value = ""; await loadAdminOverview(); await refreshData(); }
}
function editAdminPlan(idx) {
  const p = (window.__adminPlans || [])[idx]; if (!p) return;
  $("adminPlanLevel").value = p.vip_level; $("adminPlanTitle").value = p.title; $("adminPlanPrice").value = p.price_usdt;
  $("adminPlanDuration").value = p.duration_days; $("adminPlanDescription").value = p.description || ""; $("adminPlanActive").value = String(Number(p.is_active));
  $("adminPlanDaily").value = p.daily_usdt || 0; $("adminPlanLimit").value = p.earn_total_limit || 0;
  $("adminPlanEStart").value = p.earn_start_at ? new Date(Number(p.earn_start_at)).toISOString().slice(0, 10) : ""; $("adminPlanEEnd").value = p.earn_end_at ? new Date(Number(p.earn_end_at)).toISOString().slice(0, 10) : ""; $("adminPlanApply").value = "0";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function saveAdminPlan() {
  if ($("adminPlanApply").value === "1" && !confirm("This changes the earning terms of members who ALREADY bought this plan. Continue?")) return;
  const lvl = Number($("adminPlanLevel").value);
  const res = await api("/api/admin/upsert-plan", { method: "POST", body: JSON.stringify({ vip_level: lvl, title: ($("adminPlanTitle").value || `VIP ${lvl}`).trim(), price_usdt: Number($("adminPlanPrice").value), duration_days: Number($("adminPlanDuration").value), description: $("adminPlanDescription").value, is_active: $("adminPlanActive").value === "1", daily_usdt: Number($("adminPlanDaily").value || 0), earn_total_limit: Number($("adminPlanLimit").value || 0), earn_start_at: dayStart("adminPlanEStart"), earn_end_at: dayEnd("adminPlanEEnd"), apply_to_existing: $("adminPlanApply").value === "1", confirm: $("adminPlanApply").value === "1" }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { ["adminPlanLevel", "adminPlanTitle", "adminPlanPrice", "adminPlanDuration", "adminPlanDescription", "adminPlanDaily", "adminPlanLimit", "adminPlanEStart", "adminPlanEEnd"].forEach((i) => { $(i).value = ""; }); await loadAdminOverview(); await refreshData(); }
}
async function togglePlan(idx) {
  const p = (window.__adminPlans || [])[idx]; if (!p) return;
  const res = await api("/api/admin/upsert-plan", { method: "POST", body: JSON.stringify({ vip_level: p.vip_level, title: p.title, price_usdt: p.price_usdt, duration_days: p.duration_days, description: p.description || "", is_active: !Number(p.is_active) }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await refreshData(); }
}
async function deleteAdminPlan(level) {
  if (!confirm(`Delete plan level ${level}?`)) return;
  const res = await api("/api/admin/delete-plan", { method: "POST", body: JSON.stringify({ vip_level: level }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await refreshData(); }
}
function toggleNotifTarget() { $("notifTargetWrap").classList.toggle("hidden", $("notifAudience").value !== "user"); }
async function sendAdminNotification() {
  const res = await api("/api/admin/send-notification", { method: "POST", body: JSON.stringify({ title: $("notifTitle").value, body: $("notifBody").value, audience: $("notifAudience").value, email: $("notifEmail").value }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("notifTitle").value = ""; $("notifBody").value = ""; $("notifEmail").value = ""; await loadAdminOverview(); }
}
async function deleteAdminNotification(id) {
  if (!confirm("Delete this notification for everyone who received it?")) return;
  const res = await api("/api/admin/delete-notification", { method: "POST", body: JSON.stringify({ id }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}
async function addNewSuperAdmin() {
  const res = await api("/api/admin/add-super-admin", { method: "POST", body: JSON.stringify({ newAdminEmail: $("newSuperAdminInput").value }) });
  if (res.ok) $("newSuperAdminInput").value = "";
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}
async function removeSuperAdminAt(index) {
  const email = (window.__adminAccounts || [])[index]?.email; if (!email) return;
  if (!confirm(`Remove Super Admin access for ${email}?`)) return;
  const res = await api("/api/admin/remove-super-admin", { method: "POST", body: JSON.stringify({ email }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  setToken(""); location.reload();
}

/* ---------- start ---------- */
function applyReferralFromUrl() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (!ref) return;
  $("regReferral").value = ref.trim().toUpperCase().slice(0, 20);
  if (!getToken()) toggleAuth("register");
}
window.addEventListener("DOMContentLoaded", async () => {
  applyReferralFromUrl();
  await loadPublicSettings();
  await enterApp();
});

let plans = [];
let currentUser = null;
let transactions = [];
let siteSettings = {};
let teamData = { members: [], total: 0, active: 0 };
let unread = 0;
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
  el.textContent = String(msg || "Done.").slice(0, 140);
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
    if (res.status === 401 && token && path !== "/api/auth") { setToken(""); showAuth(); }
    return data;
  } catch { return { ok: false, message: "Connection failed. Please try again." }; }
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
    `<div class="tx-row"><div><strong>${escapeHtml(m.fullname)}</strong><div class="tx-sub">${escapeHtml(m.custom_id)}</div></div><span class="tx-sub">${new Date(Number(m.created_at)).toLocaleDateString()}</span></div>`
  ).join("") || `<p class="tx-sub">No referred members yet.</p>`;

  // plans: only plans created in the admin panel
  $("homeVipGrid").innerHTML = plans.length ? plans.slice(0, 6).map((p, i) => planCardHtml(p, i, vipLevel)).join("") : `<p class="tx-sub">No plans available yet.</p>`;
  $("allVipPlansContainer").innerHTML = plans.length ? plans.map((p, i) => planCardHtml(p, i, vipLevel)).join("") : `<p class="tx-sub">No plans available yet.</p>`;

  // products: current plan
  $("prodDailyVal").textContent = usdt(siteSettings.checkin_reward);
  $("checkinNote").textContent = siteSettings.checkin_requires_vip !== "0" ? "Requires an active plan • once every 24 hours" : "Claim once every 24 hours";
  if (vipLevel > 0 && activePlan) {
    const expires = Number(currentUser.vip_expires_at || 0);
    $("prodActiveTitle").textContent = activePlan.title || `VIP ${vipLevel}`;
    $("prodActivePrice").textContent = usdt(activePlan.price_usdt);
    $("prodDuration").textContent = `${Number(activePlan.duration_days)} Days`;
    $("prodDaysLeft").textContent = `${Math.max(0, Math.ceil((expires - Date.now()) / 86400000))} Days`;
    $("prodStartDate").textContent = expires ? new Date(expires - Number(activePlan.duration_days) * 86400000).toLocaleDateString() : "—";
    $("prodStatusPill").textContent = "Active";
  } else {
    ["prodActivePrice", "prodDuration", "prodDaysLeft", "prodStartDate"].forEach((id) => { $(id).textContent = "—"; });
    $("prodActiveTitle").textContent = "No Plan";
    $("prodStatusPill").textContent = "No active plan";
  }
}

/* ---------- history ---------- */
const HIST = {
  all: () => true,
  deposits: (t) => /deposit/i.test(t.type),
  withdrawals: (t) => /withdraw/i.test(t.type),
  plans: (t) => /purchase|upgrade/i.test(t.type),
  rewards: (t) => /check-in|bonus/i.test(t.type),
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
    if (t.status === "Approved" && !isActivity) sign = /deposit|check-in|bonus/i.test(t.type) ? "+" : "−";
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
  $("planDetailBody").innerHTML = `
    <div class="dark-panel neon-green-box">
      <div class="info-row"><span>Price</span><strong>${usdt(p.price_usdt)}</strong></div>
      <div class="info-row"><span>Duration</span><strong>${Number(p.duration_days)} Days</strong></div>
      ${perk}
      <div class="info-row"><span>Your balance</span><strong>${usdt(balance)}</strong></div>
      <div class="info-row"><span>Status</span><strong>${isCurrent ? "Active" : lower ? "Lower tier" : "Available"}</strong></div>
    </div>
    ${desc ? `<div class="dark-panel neon-green-box"><h3 class="panel-heading">About this plan</h3><p class="plan-desc">${escapeHtml(desc).replace(/\n/g, "<br />")}</p></div>` : ""}
    <div class="dark-panel neon-green-box">${action}<p class="tx-sub" style="margin-top:8px;">The price is deducted from your balance when you activate.</p></div>`;
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
    const dayMs = 86400000, lastMs = Number(currentUser.last_checkin_ms || 0), elapsed = Date.now() - lastMs;
    const needsPlan = siteSettings.checkin_requires_vip !== "0" && Number(currentUser.vip_level || 0) <= 0;
    const off = Number(siteSettings.checkin_reward || 0) <= 0;
    if (lastMs && elapsed < dayMs) {
      const rem = Math.max(0, Math.floor((dayMs - elapsed) / 1000));
      el.textContent = [Math.floor(rem / 3600), Math.floor((rem % 3600) / 60), rem % 60].map((n) => String(n).padStart(2, "0")).join(":");
      btn.disabled = true;
    } else { el.textContent = "00:00:00"; btn.disabled = needsPlan || off; }
  };
  tick(); countdownInterval = setInterval(tick, 1000);
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
const SETTING_FIELDS = { cfgCompanyName: "company_name", cfgBrandShort: "brand_short", cfgTagline: "tagline", cfgHeroTitle: "hero_title", cfgHeroSubtitle: "hero_subtitle", cfgAnnouncement: "announcement", cfgFaq: "faq_text", cfgDepositAddress: "deposit_address", cfgDepositNetwork: "deposit_network", cfgDepositMin: "deposit_min", cfgDepositMax: "deposit_max", cfgWithdrawMin: "withdraw_min", cfgCheckinReward: "checkin_reward", cfgDepositInstructions: "deposit_instructions", cfgRegistrationOpen: "registration_open", cfgCheckinRequiresVip: "checkin_requires_vip", cfgLiveChat: "live_chat_url", cfgTelegram: "telegram_url", cfgWhatsapp: "whatsapp_url" };
const SETTING_GROUPS = {
  site: ["cfgCompanyName", "cfgBrandShort", "cfgTagline", "cfgHeroTitle", "cfgHeroSubtitle", "cfgAnnouncement", "cfgFaq"],
  pay: ["cfgDepositAddress", "cfgDepositNetwork", "cfgDepositMin", "cfgDepositMax", "cfgWithdrawMin", "cfgCheckinReward", "cfgDepositInstructions", "cfgRegistrationOpen", "cfgCheckinRequiresVip"],
  links: ["cfgLiveChat", "cfgTelegram", "cfgWhatsapp"]
};

function renderAdminUsers(list) {
  window.__adminUsers = list;
  $("adminMembersContainer").innerHTML = list.map((u, idx) => `
    <div class="tx-row">
      <div>
        <strong>${escapeHtml(u.fullname)}</strong> ${u.is_banned ? '<span class="st-badge Rejected">Suspended</span>' : ""}
        <div class="tx-sub">${escapeHtml(u.custom_id)} • ${escapeHtml(u.email)}</div>
        <div class="tx-sub">Balance: ${usdt(u.balance_usdt)} • VIP ${Number(u.vip_level) > 0 && Number(u.vip_expires_at) > Date.now() ? Number(u.vip_level) : 0}</div>
      </div>
      <div class="tx-btns">
        <button type="button" class="mini-action-btn" onclick="adminUserAction(${idx},'${u.is_banned ? "unban" : "ban"}')">${u.is_banned ? "Re-activate" : "Suspend"}</button>
        <button type="button" class="mini-action-btn" onclick="adminUserAction(${idx},'reset-pin')">Reset PIN</button>
      </div>
    </div>`).join("") || `<p class="tx-sub">No members found.</p>`;
}
async function searchAdminUsers() {
  const d = await api(`/api/admin/users?q=${encodeURIComponent($("adminUserSearch").value.trim())}`);
  if (!d.ok) return smartAlert(d.message, "error");
  renderAdminUsers(d.users || []);
}
async function adminUserAction(idx, action) {
  const u = (window.__adminUsers || [])[idx]; if (!u) return;
  const labels = { ban: "Suspend", unban: "Re-activate", "reset-pin": "Clear the transaction PIN of" };
  if (!confirm(`${labels[action]} ${u.email}?`)) return;
  const res = await api("/api/admin/user-action", { method: "POST", body: JSON.stringify({ email: u.email, action }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await ($("adminUserSearch").value.trim() ? searchAdminUsers() : loadAdminOverview());
}

async function loadAdminOverview() {
  if (!currentUser || !currentUser.is_super_admin) return;
  const d = await api("/api/admin/overview");
  if (!d.ok) return smartAlert(d.message, "error");
  window.__adminPlans = d.plans || [];
  adminPending = { deposits: (d.pending_deposits || []).length, withdrawals: (d.pending_withdrawals || []).length };
  applyBadges();

  $("adminPlansContainer").innerHTML = window.__adminPlans.map((p, idx) => `
    <div class="tx-row"><div><strong>${escapeHtml(p.title)} (Level ${Number(p.vip_level)})</strong><div class="tx-sub">${usdt(p.price_usdt)} • ${Number(p.duration_days)} days</div></div>
    <div class="tx-btns"><button type="button" class="mini-action-btn" onclick="editAdminPlan(${idx})">Edit</button><button type="button" class="mini-action-btn" onclick="deleteAdminPlan(${Number(p.vip_level)})">Delete</button></div></div>`).join("") || `<p class="tx-sub">No plans yet. Add your first plan above.</p>`;
  if (!$("adminPlanLevel").value) $("adminPlanLevel").value = Math.max(0, ...window.__adminPlans.map((p) => Number(p.vip_level))) + 1;

  const cfg = d.settings || {};
  for (const [id, key] of Object.entries(SETTING_FIELDS)) { const el = $(id); if (el && document.activeElement !== el) el.value = cfg[key] ?? ""; }

  window.__adminAccounts = d.super_admins || [];
  $("superAdminsContainer").innerHTML = window.__adminAccounts.map((a, idx) => `<div class="tx-row"><div><strong>${escapeHtml(a.email)}</strong><div class="tx-sub">Added by: ${escapeHtml(a.added_by)}</div></div><div class="tx-btns"><span class="st-badge Approved">${escapeHtml(a.role)}</span>${a.email.toLowerCase() !== currentUser.email.toLowerCase() ? `<button type="button" class="mini-action-btn" onclick="removeSuperAdminAt(${idx})">Remove</button>` : ""}</div></div>`).join("");

  $("pendingWithdrawalsContainer").innerHTML = (d.pending_withdrawals || []).map((w) => `<div class="tx-row"><div><strong>#${Number(w.id)} • ${escapeHtml(w.user_email)}</strong><div class="tx-sub">${usdt(w.amount_usdt)}</div><div class="tx-sub wrap-any">${escapeHtml(w.details || "")}</div></div><div class="tx-btns"><button type="button" class="mini-action-btn" onclick="decideWithdrawal(${Number(w.id)},'Approved')">Approve</button><button type="button" class="mini-action-btn" onclick="decideWithdrawal(${Number(w.id)},'Rejected')">Reject</button></div></div>`).join("") || `<p class="tx-sub">No pending withdrawals.</p>`;

  if (!$("adminUserSearch").value.trim()) renderAdminUsers(d.recent_users || []);

  const deposits = d.pending_deposits || [];
  $("pendingDepositsContainer").innerHTML = deposits.map((x) => `<div class="admin-review-row"><strong>Deposit #${Number(x.id)} • ${escapeHtml(x.user_email)}</strong><div class="tx-sub">${usdt(x.amount_usdt)} • ${escapeHtml(x.network)} • ${new Date(Number(x.created_at)).toLocaleString()}</div><div class="tx-sub wrap-any">Reference: ${escapeHtml(x.tx_reference || "Not supplied")}</div><div id="proof-${Number(x.id)}" class="tx-sub">Loading payment proof…</div><input id="deposit-note-${Number(x.id)}" placeholder="Optional review note" /><div class="admin-review-actions"><button type="button" class="approve" onclick="reviewDeposit(${Number(x.id)},'Approved')">Approve &amp; Credit</button><button type="button" class="reject" onclick="reviewDeposit(${Number(x.id)},'Rejected')">Reject</button></div></div>`).join("") || `<p class="tx-sub">No pending deposit requests.</p>`;
  for (const x of deposits) loadDepositProof(Number(x.id));

  $("adminNotifList").innerHTML = (d.notifications || []).map((n) => `<div class="tx-row"><div><strong>${escapeHtml(n.title)}</strong><div class="tx-sub">${escapeHtml(n.body || "")}</div><div class="tx-sub">${n.user_email ? escapeHtml(n.user_email) : "All members"} • ${new Date(Number(n.created_at)).toLocaleString()}</div></div><button type="button" class="mini-action-btn" onclick="deleteAdminNotification(${Number(n.id)})">Delete</button></div>`).join("") || `<p class="tx-sub">Nothing sent yet.</p>`;
}

async function loadDepositProof(id) {
  try {
    const res = await fetch(`/api/admin/deposit-proof/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error();
    const url = URL.createObjectURL(await res.blob());
    const box = $(`proof-${id}`); if (box) box.innerHTML = `<img src="${url}" alt="Payment proof for deposit ${id}" />`;
  } catch { const box = $(`proof-${id}`); if (box) box.textContent = "Unable to load proof image."; }
}
async function reviewDeposit(requestId, decision) {
  if (!confirm(decision === "Approved" ? `Approve deposit #${requestId} and credit the member?` : `Reject deposit #${requestId}?`)) return;
  const note = $(`deposit-note-${requestId}`)?.value || "";
  const res = await api("/api/admin/deposit-action", { method: "POST", body: JSON.stringify({ requestId, decision, note }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}
async function decideWithdrawal(txId, decision) {
  if (!confirm(`${decision === "Approved" ? "Approve" : "Reject"} withdrawal #${txId}? ${decision === "Approved" ? "Make sure you have sent the USDT first." : "The amount will be refunded to the member."}`)) return;
  const res = await api("/api/admin/withdrawal-action", { method: "POST", body: JSON.stringify({ txId, decision }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}
async function savePlatformSettings(group) {
  const body = {};
  for (const id of SETTING_GROUPS[group] || []) body[SETTING_FIELDS[id]] = $(id).value;
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
  $("adminPlanDuration").value = p.duration_days; $("adminPlanDescription").value = p.description || "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function saveAdminPlan() {
  const lvl = Number($("adminPlanLevel").value);
  const res = await api("/api/admin/upsert-plan", { method: "POST", body: JSON.stringify({ vip_level: lvl, title: ($("adminPlanTitle").value || `VIP ${lvl}`).trim(), price_usdt: Number($("adminPlanPrice").value), duration_days: Number($("adminPlanDuration").value), description: $("adminPlanDescription").value }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { ["adminPlanLevel", "adminPlanTitle", "adminPlanPrice", "adminPlanDuration", "adminPlanDescription"].forEach((i) => { $(i).value = ""; }); await loadAdminOverview(); await refreshData(); }
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

let plans = [];
let currentUser = null;
let transactions = [];
let countdownInterval = null;
let siteSettings = {};
let teamData = { members: [], total: 0, active: 0 };

const $ = (id) => document.getElementById(id);
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function getToken() { try { return localStorage.getItem("pdf_session_token") || ""; } catch { return ""; } }
function setToken(v) { try { v ? localStorage.setItem("pdf_session_token", v) : localStorage.removeItem("pdf_session_token"); } catch { /* storage blocked */ } }

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
  if (countdownInterval) clearInterval(countdownInterval);
  currentUser = null;
  $("authWrap").style.display = "flex";
  $("appShell").style.display = "none";
}

function switchTab(sectionId, navBtn) {
  document.querySelectorAll(".tab-section").forEach((sec) => sec.classList.remove("active"));
  const target = $(sectionId);
  if (target) target.classList.add("active");
  document.querySelectorAll(".nav-tab").forEach((btn) => btn.classList.remove("active"));
  if (navBtn && navBtn.classList.contains("nav-tab")) navBtn.classList.add("active");
  else { const match = document.querySelector(`.nav-tab[data-target="${sectionId}"]`); if (match) match.classList.add("active"); }
  window.scrollTo({ top: 0 });
  if (sectionId === "sec-admin") loadAdminOverview();
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
    // An invalid/expired session sends the member back to the sign-in screen.
    if (res.status === 401 && token && path !== "/api/auth") { setToken(""); showAuth(); }
    return data;
  } catch {
    return { ok: false, message: "Connection failed. Please try again." };
  }
}

/* ---------- auth ---------- */
$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/auth", {
    method: "POST",
    body: JSON.stringify({
      mode: "register",
      fullname: $("regName").value,
      email: $("regEmail").value,
      phone: $("regPhone").value,
      referral: $("regReferral").value,
      password: $("regPassword").value,
      setup_key: $("regSetupKey").value
    })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  $("regPassword").value = ""; $("regSetupKey").value = "";
  toggleAuth("login");
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/auth", {
    method: "POST",
    body: JSON.stringify({ mode: "login", email: $("loginEmail").value.toLowerCase().trim(), password: $("loginPassword").value })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  setToken(res.token);
  $("loginPassword").value = "";
  smartAlert(res.message, "success");
  await enterApp();
});

async function loadPublicSettings() {
  const data = await api("/api/public-settings");
  if (data.ok) {
    siteSettings = data.settings || {};
    renderPublicSettings();
  }
}

async function enterApp() {
  if (!getToken()) return showAuth();
  const data = await api("/api/user");
  if (!data.ok) { setToken(""); return showAuth(); }
  currentUser = data.user;
  plans = data.plans || [];
  transactions = data.transactions || [];
  siteSettings = data.settings || {};
  teamData = data.team || { members: [], total: 0, active: 0 };
  $("authWrap").style.display = "none";
  $("appShell").style.display = "block";
  $("adminTopBtn").classList.toggle("hidden", !currentUser.is_super_admin);
  renderApp();
  renderPublicSettings();
  startCountdownTicker();
}

/* ---------- rendering ---------- */
function renderApp() {
  if (!currentUser) return;
  const vipLevel = Number(currentUser.vip_level || 0);
  const balance = Number(currentUser.balance_usdt || 0);
  const memberId = currentUser.custom_id;

  $("homeMemberId").textContent = memberId;
  $("homeBalanceVal").textContent = `${balance.toFixed(2)} USDT`;
  $("profileEmailVal").textContent = currentUser.email;
  $("referralLinkInput").value = `${window.location.origin}/?ref=${encodeURIComponent(memberId)}`;

  let totalDeposit = 0, totalStake = 0, totalReward = 0;
  transactions.forEach((t) => {
    const amt = Number(t.amount_usdt || 0);
    const type = String(t.type || "").toLowerCase();
    if (t.status !== "Approved") return;
    if (type.includes("deposit")) totalDeposit += amt;
    if (type.includes("purchase") || type.includes("upgrade")) totalStake += amt;
    if (type.includes("check-in") || type.includes("bonus")) totalReward += amt;
  });

  $("statTotalDeposit").textContent = `${totalDeposit.toFixed(2)} USDT`;
  $("statTotalStake").textContent = `${totalStake.toFixed(2)} USDT`;
  $("statTotalReward").textContent = `${totalReward.toFixed(2)} USDT`;
  $("statMyTeam").textContent = `${teamData.total || 0} Members`;

  const weekAgo = Date.now() - 7 * 86400000;
  const recent = (teamData.members || []).filter((m) => Number(m.created_at) > weekAgo).length;
  $("teamTotalMembers").textContent = String(teamData.total || 0);
  $("teamActiveMembers").textContent = String(teamData.active || 0);
  $("teamDirectRefs").textContent = String(teamData.total || 0);
  $("teamRecentVal").textContent = String(recent);
  $("perfMembers").textContent = String(teamData.total || 0);
  $("teamMembersList").innerHTML = (teamData.members || []).slice(0, 10).map((m) =>
    `<div class="member-slot"><div class="slot-ring">👤</div><span>${escapeHtml(m.fullname)}</span><small>${new Date(Number(m.created_at)).toLocaleDateString()}</small></div>`
  ).join("") || `<p class="tx-sub">No referred members yet.</p>`;

  $("walletAddress").value = currentUser.wallet_address || "";
  $("walletNetwork").value = currentUser.wallet_network || "TRC20";
  $("homeStatusPill").textContent = vipLevel > 0 ? "✓ Active Plan" : "Member";

  const tierClasses = ["", "tier-blue", "tier-gold"];
  const wreathIcons = ["👑", "🥈", "🏆"];
  const checkinNote = siteSettings.checkin_requires_vip !== "0" ? "<br />Unlocks daily check-in" : "";
  const renderPlanCardsHtml = (list) => {
    if (!list.length) return `<p class="tx-sub">No VIP plans yet.</p>`;
    return list.map((p, idx) => {
      const lvl = Number(p.vip_level);
      const isCurrent = lvl === vipLevel;
      const disabled = lvl <= vipLevel;
      return `
        <div class="vip-card-item ${tierClasses[idx % 3] || ""}">
          <div>
            <div class="vip-pill-head">${escapeHtml(p.title || `VIP ${lvl}`)}</div>
            <div class="vip-wreath-icon">${wreathIcons[idx % 3]}</div>
            <div class="vip-price-big">${Number(p.price_usdt).toFixed(2)} USDT</div>
            <div class="vip-line-meta">Duration: ${Number(p.duration_days)} Days${checkinNote}</div>
          </div>
          <button type="button" class="vip-upgrade-btn" ${disabled ? "disabled" : ""} onclick="buyVip(${lvl})">
            ${isCurrent ? "Active" : disabled ? "Lower Tier" : "Upgrade Now &gt;"}
          </button>
        </div>`;
    }).join("");
  };
  $("homeVipGrid").innerHTML = renderPlanCardsHtml(plans.slice(0, 3));
  $("allVipPlansContainer").innerHTML = renderPlanCardsHtml(plans);

  const activePlan = plans.find((x) => Number(x.vip_level) === vipLevel);
  $("prodDailyVal").textContent = `${Number(siteSettings.checkin_reward ?? 0).toFixed(2)} USDT`;
  if (vipLevel > 0 && activePlan) {
    $("prodActiveTitle").textContent = activePlan.title || `VIP ${vipLevel}`;
    $("prodActivePrice").textContent = `${Number(activePlan.price_usdt).toFixed(2)} USDT`;
    $("prodDuration").textContent = `${Number(activePlan.duration_days)} Days`;
    const expires = Number(currentUser.vip_expires_at || 0);
    $("prodDaysLeft").textContent = `${Math.max(0, Math.ceil((expires - Date.now()) / 86400000))} Days`;
    $("prodStatusPill").textContent = "Active";
    $("prodStartDate").textContent = expires ? new Date(expires - Number(activePlan.duration_days) * 86400000).toLocaleDateString() : "—";
  } else {
    $("prodActiveTitle").textContent = "No Plan";
    $("prodActivePrice").textContent = "—";
    $("prodDuration").textContent = "—";
    $("prodDaysLeft").textContent = "—";
    $("prodStartDate").textContent = "—";
    $("prodStatusPill").textContent = "No active plan";
  }
  $("prodTotalEarnings").textContent = `${totalReward.toFixed(2)} USDT`;
  $("prodTotalDeposit").textContent = `${totalDeposit.toFixed(2)} USDT`;

  const histBox = $("txHistoryList");
  histBox.innerHTML = !transactions.length ? `<p class="tx-sub">No transactions yet.</p>` : transactions.map((t) => `
    <div class="tx-row">
      <div>
        <strong>${escapeHtml(t.type)}</strong>
        <div class="tx-sub">${escapeHtml(t.details || "")} • ${new Date(Number(t.created_at)).toLocaleString()}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:900; color:var(--neon-green);">${Number(t.amount_usdt || 0).toFixed(2)} USDT</div>
        <span class="st-badge ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span>
      </div>
    </div>`).join("");
}

function setExternalLink(id, url) {
  const el = $(id);
  if (!el) return;
  if (url && /^https:\/\//i.test(url)) { el.href = url; el.classList.remove("hidden"); }
  else { el.href = "#"; el.classList.add("hidden"); }
}

function renderPublicSettings() {
  const cfg = siteSettings || {};
  const banner = $("heroBannerImg");
  if (banner) {
    if (cfg.banner_key) { banner.src = `/media/${cfg.banner_key}`; banner.classList.remove("hidden"); }
    else { banner.removeAttribute("src"); banner.classList.add("hidden"); }
  }
  document.querySelectorAll(".brand-name").forEach((el) => { el.innerHTML = `${escapeHtml(cfg.company_name || "Prime Digital Finance")} <span>(${escapeHtml(cfg.brand_short || "PDF")})</span>`; });
  if ($("heroTitle")) $("heroTitle").textContent = cfg.hero_title || "PRIME DIGITAL FINANCE";
  if ($("heroSubtitle")) $("heroSubtitle").textContent = cfg.hero_subtitle || "Your account. Your transactions. Clear records.";
  document.querySelectorAll(".brand-tagline").forEach((el) => { el.textContent = cfg.tagline || "FINANCE • TRANSPARENCY • CONTROL"; });
  if ($("announcementText")) $("announcementText").textContent = cfg.announcement || "Welcome to Prime Digital Finance.";
  const faq = document.querySelector("#faqPanel p"); if (faq) faq.textContent = cfg.faq_text || "Contact support if you need help with a payment or account.";
  setExternalLink("liveChatLink", cfg.live_chat_url);
  setExternalLink("supportChatLink", cfg.live_chat_url);
  setExternalLink("telegramChannelLink", cfg.telegram_url);
  setExternalLink("whatsappChannelLink", cfg.whatsapp_url);
  if ($("depositNetworkLabel")) $("depositNetworkLabel").textContent = cfg.deposit_network || "TRC20";
  if ($("depositAddressLabel")) $("depositAddressLabel").textContent = cfg.deposit_address || "Admin has not configured a deposit wallet.";
  if ($("depositInstructionsLabel")) $("depositInstructionsLabel").textContent = cfg.deposit_instructions || "Please contact support for deposit instructions.";
  if ($("depositLimitsLabel")) $("depositLimitsLabel").textContent = `${cfg.deposit_min || 1}–${cfg.deposit_max || 5000} USDT`;
  if ($("withdrawHeading")) $("withdrawHeading").textContent = `Withdraw USDT (Minimum ${cfg.withdraw_min || 2} USDT)`;
  if ($("withdrawAmount")) $("withdrawAmount").min = cfg.withdraw_min || 2;
  if ($("regClosedNote")) $("regClosedNote").classList.toggle("hidden", cfg.registration_open !== "0");
}

function startCountdownTicker() {
  if (countdownInterval) clearInterval(countdownInterval);
  const updateClock = () => {
    const el = $("countdownClock"), btn = $("prodCheckinBtn");
    if (!el || !currentUser) return;
    const dayMs = 24 * 60 * 60 * 1000;
    const lastMs = Number(currentUser.last_checkin_ms || 0);
    const elapsed = Date.now() - lastMs;
    const needsPlan = siteSettings.checkin_requires_vip !== "0" && Number(currentUser.vip_level || 0) <= 0;
    const disabled = Number(siteSettings.checkin_reward || 0) <= 0;
    if (lastMs && elapsed < dayMs) {
      const remSec = Math.max(0, Math.floor((dayMs - elapsed) / 1000));
      el.textContent = [Math.floor(remSec / 3600), Math.floor((remSec % 3600) / 60), remSec % 60].map((n) => String(n).padStart(2, "0")).join(":");
      if (btn) btn.disabled = true;
    } else {
      el.textContent = "00:00:00";
      if (btn) btn.disabled = needsPlan || disabled;
    }
    if (btn) btn.title = needsPlan ? "Activate a product plan to use the daily check-in" : "";
  };
  updateClock();
  countdownInterval = setInterval(updateClock, 1000);
}

/* ---------- member actions ---------- */
function openDepositBox() { $("depositDrawer").classList.remove("hidden"); $("depositInput").focus(); }
function goToDeposit() { switchTab("sec-home"); openDepositBox(); }

async function submitQuickDeposit() {
  const amount = Number($("depositInput").value);
  const proof = $("depositProof").files[0];
  if (!Number.isFinite(amount) || amount <= 0) return smartAlert("Enter the amount you sent.", "error");
  if (!proof) return smartAlert("Please upload your payment screenshot.", "error");
  if (proof.size > 3 * 1024 * 1024) return smartAlert("Screenshot must be 3 MB or smaller.", "error");
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("network", siteSettings.deposit_network || "TRC20");
  form.append("tx_reference", $("depositTxRef").value.trim());
  form.append("proof", proof);
  const res = await api("/api/deposit", { method: "POST", body: form });
  if (!res.ok) return smartAlert(res.message, "error");
  $("depositInput").value = ""; $("depositTxRef").value = ""; $("depositProof").value = "";
  $("depositDrawer").classList.add("hidden");
  smartAlert(res.message, "success");
  await enterApp();
}
function copyDepositAddress() {
  const value = $("depositAddressLabel").textContent;
  if (!value || value.includes("not configured")) return smartAlert("Deposit wallet has not been configured.", "error");
  navigator.clipboard?.writeText(value).then(() => smartAlert("Deposit address copied.", "success")).catch(() => smartAlert("Could not copy address.", "error"));
}

async function buyVip(vip) {
  const plan = plans.find((p) => Number(p.vip_level) === Number(vip));
  if (plan && !confirm(`Activate ${plan.title} for ${Number(plan.price_usdt).toFixed(2)} USDT? This amount will be deducted from your balance.`)) return;
  const res = await api("/api/buy-vip", { method: "POST", body: JSON.stringify({ vip }) });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await enterApp();
}

async function claimDailyReward() {
  const res = await api("/api/checkin", { method: "POST", body: "{}" });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await enterApp();
}

function copyText(text, okMsg) {
  const done = () => smartAlert(okMsg, "success");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => smartAlert("Could not copy.", "error"));
  else smartAlert("Copy is not supported in this browser.", "error");
}
function copyMemberId() { copyText($("homeMemberId").textContent, `Copied Member ID: ${$("homeMemberId").textContent}`); }
function copyReferralLink() { copyText($("referralLinkInput").value, "Referral link copied!"); }

function shareReferral(channel) {
  const link = encodeURIComponent($("referralLinkInput").value);
  const text = encodeURIComponent("Join me on Prime Digital Finance (PDF): ");
  const url = channel === "whatsapp" ? `https://wa.me/?text=${text}${link}` : `https://t.me/share/url?url=${link}&text=${text}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function toggleFaqBox() { $("faqPanel").classList.toggle("hidden"); }
function scrollToAllPlans() { $("allVipPlansContainer").scrollIntoView({ behavior: "smooth" }); }

async function saveWalletAddress() {
  const res = await api("/api/payment-method", {
    method: "POST",
    body: JSON.stringify({ wallet_network: $("walletNetwork").value, wallet_address: $("walletAddress").value.trim() })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await enterApp();
}

async function saveSecurityPin() {
  const pin = $("newPin").value;
  if (!/^\d{4}$/.test(pin)) return smartAlert("PIN must be exactly 4 digits.", "error");
  const res = await api("/api/security-pin", { method: "POST", body: JSON.stringify({ pin }) });
  if (res.ok) $("newPin").value = "";
  smartAlert(res.message, res.ok ? "success" : "error");
}

async function submitWithdrawal() {
  const amount = Number($("withdrawAmount").value);
  if (!Number.isFinite(amount) || amount <= 0) return smartAlert("Enter a valid amount.", "error");
  const res = await api("/api/withdraw", { method: "POST", body: JSON.stringify({ amount, pin: $("withdrawPin").value }) });
  $("withdrawPin").value = "";
  if (!res.ok) return smartAlert(res.message, "error");
  $("withdrawAmount").value = "";
  smartAlert(res.message, "success");
  await enterApp();
}

/* ---------- admin panel ---------- */
const SETTING_FIELDS = { cfgCompanyName: "company_name", cfgBrandShort: "brand_short", cfgTagline: "tagline", cfgHeroTitle: "hero_title", cfgHeroSubtitle: "hero_subtitle", cfgDepositAddress: "deposit_address", cfgDepositNetwork: "deposit_network", cfgDepositMin: "deposit_min", cfgDepositMax: "deposit_max", cfgWithdrawMin: "withdraw_min", cfgCheckinReward: "checkin_reward", cfgDepositInstructions: "deposit_instructions", cfgLiveChat: "live_chat_url", cfgTelegram: "telegram_url", cfgWhatsapp: "whatsapp_url", cfgAnnouncement: "announcement", cfgFaq: "faq_text", cfgRegistrationOpen: "registration_open", cfgCheckinRequiresVip: "checkin_requires_vip" };

function renderAdminUsers(list) {
  window.__adminUsers = list;
  $("adminMembersContainer").innerHTML = list.map((u, idx) => `
    <div class="tx-row">
      <div>
        <strong>${escapeHtml(u.fullname)}</strong> ${u.is_banned ? '<span class="st-badge Rejected">Suspended</span>' : ""}
        <div class="tx-sub">${escapeHtml(u.custom_id)} • ${escapeHtml(u.email)}</div>
        <div class="tx-sub">Balance: ${Number(u.balance_usdt).toFixed(2)} USDT • VIP ${Number(u.vip_level) > 0 && Number(u.vip_expires_at) > Date.now() ? Number(u.vip_level) : 0}</div>
      </div>
      <div class="tx-btns">
        <button type="button" class="mini-action-btn" onclick="adminUserAction(${idx},'${u.is_banned ? "unban" : "ban"}')">${u.is_banned ? "Re-activate" : "Suspend"}</button>
        <button type="button" class="mini-action-btn" onclick="adminUserAction(${idx},'reset-pin')">Reset PIN</button>
      </div>
    </div>`).join("") || `<p class="tx-sub">No members found.</p>`;
}

async function searchAdminUsers() {
  const q = $("adminUserSearch").value.trim();
  const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
  if (!data.ok) return smartAlert(data.message, "error");
  renderAdminUsers(data.users || []);
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
  const data = await api("/api/admin/overview");
  if (!data.ok) return smartAlert(data.message, "error");
  window.__adminPlans = data.plans || [];
  $("adminPlansContainer").innerHTML = window.__adminPlans.map((p, idx) => `
    <div class="tx-row"><div><strong>${escapeHtml(p.title)} (Level ${Number(p.vip_level)})</strong><div class="tx-sub">Price: ${Number(p.price_usdt).toFixed(2)} USDT • ${Number(p.duration_days)} days</div></div><div class="tx-btns"><button type="button" class="mini-action-btn" onclick="editAdminPlan(${idx})">Edit</button><button type="button" class="mini-action-btn" onclick="deleteAdminPlan(${Number(p.vip_level)})">Delete</button></div></div>`).join("") || `<p class="tx-sub">No products configured.</p>`;

  const cfg = data.settings || {};
  for (const [id, key] of Object.entries(SETTING_FIELDS)) { const el = $(id); if (el) el.value = cfg[key] ?? ""; }

  window.__adminAccounts = data.super_admins || [];
  $("superAdminsContainer").innerHTML = window.__adminAccounts.map((a, idx) => `<div class="tx-row"><div><strong>${escapeHtml(a.email)}</strong><div class="tx-sub">Added by: ${escapeHtml(a.added_by)}</div></div><div class="tx-btns"><span class="st-badge Approved">${escapeHtml(a.role)}</span>${a.email.toLowerCase() !== currentUser.email.toLowerCase() ? `<button type="button" class="mini-action-btn" onclick="removeSuperAdminAt(${idx})">Remove</button>` : ""}</div></div>`).join("");

  $("pendingWithdrawalsContainer").innerHTML = (data.pending_withdrawals || []).map((w) => `<div class="tx-row"><div><strong>#${Number(w.id)} • ${escapeHtml(w.user_email)}</strong><div class="tx-sub">${Number(w.amount_usdt).toFixed(2)} USDT</div><div class="tx-sub">${escapeHtml(w.details || "")}</div></div><div class="tx-btns"><button type="button" class="mini-action-btn" onclick="decideWithdrawal(${Number(w.id)},'Approved')">Approve</button><button type="button" class="mini-action-btn" onclick="decideWithdrawal(${Number(w.id)},'Rejected')">Reject</button></div></div>`).join("") || `<p class="tx-sub">No pending withdrawals.</p>`;

  if (!$("adminUserSearch").value.trim()) renderAdminUsers(data.recent_users || []);

  const deposits = data.pending_deposits || [];
  $("pendingDepositsContainer").innerHTML = deposits.map((d) => `<div class="admin-review-row"><strong>Deposit #${Number(d.id)} • ${escapeHtml(d.user_email)}</strong><div class="tx-sub">${Number(d.amount_usdt).toFixed(2)} USDT • ${escapeHtml(d.network)} • ${new Date(Number(d.created_at)).toLocaleString()}</div><div class="tx-sub">Reference: ${escapeHtml(d.tx_reference || "Not supplied")}</div><div id="proof-${Number(d.id)}" class="tx-sub">Loading payment proof…</div><input id="deposit-note-${Number(d.id)}" placeholder="Optional review note" /><div class="admin-review-actions"><button type="button" class="approve" onclick="reviewDeposit(${Number(d.id)},'Approved')">Approve &amp; Credit</button><button type="button" class="reject" onclick="reviewDeposit(${Number(d.id)},'Rejected')">Reject</button></div></div>`).join("") || `<p class="tx-sub">No pending deposit requests.</p>`;
  for (const d of deposits) loadDepositProof(Number(d.id));
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
  if (res.ok) { await loadAdminOverview(); await enterApp(); }
}

async function savePlatformSettings() {
  const body = {};
  for (const [id, key] of Object.entries(SETTING_FIELDS)) body[key] = $(id).value;
  const res = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await enterApp(); }
}

async function uploadHomeBanner() {
  const file = $("cfgBannerFile").files[0];
  if (!file) return smartAlert("Choose a banner image first.", "error");
  const form = new FormData(); form.append("banner", file);
  const res = await api("/api/admin/banner", { method: "POST", body: form });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { $("cfgBannerFile").value = ""; await loadAdminOverview(); await enterApp(); }
}

function editAdminPlan(idx) {
  const p = (window.__adminPlans || [])[idx];
  if (!p) return;
  $("adminPlanLevel").value = p.vip_level;
  $("adminPlanTitle").value = p.title;
  $("adminPlanPrice").value = p.price_usdt;
  $("adminPlanDuration").value = p.duration_days;
}

async function saveAdminPlan() {
  const lvl = Number($("adminPlanLevel").value);
  const res = await api("/api/admin/upsert-plan", {
    method: "POST",
    body: JSON.stringify({
      vip_level: lvl,
      title: ($("adminPlanTitle").value || `VIP ${lvl}`).trim(),
      price_usdt: Number($("adminPlanPrice").value),
      duration_days: Number($("adminPlanDuration").value)
    })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await enterApp(); }
}

async function deleteAdminPlan(vipLevel) {
  if (!confirm(`Delete product level ${vipLevel}?`)) return;
  const res = await api("/api/admin/delete-plan", { method: "POST", body: JSON.stringify({ vip_level: vipLevel }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await enterApp(); }
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

async function decideWithdrawal(txId, decision) {
  if (!confirm(`${decision === "Approved" ? "Approve" : "Reject"} withdrawal #${txId}? ${decision === "Approved" ? "Make sure you have sent the USDT first." : "The amount will be refunded to the member."}`)) return;
  const res = await api("/api/admin/withdrawal-action", { method: "POST", body: JSON.stringify({ txId, decision }) });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) { await loadAdminOverview(); await enterApp(); }
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  setToken("");
  location.reload();
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

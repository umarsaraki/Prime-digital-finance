let plans = [];
let currentUser = null;
let transactions = [];
let countdownInterval = null;
let siteSettings = {};
let teamData = { members: [], total: 0, active: 0, earnings: 0 };

function smartAlert(msg, type = "info") {
  const el = document.getElementById("smartAlert");
  el.textContent = String(msg || "Done.").slice(0, 140);
  el.className = `smart-alert ${type} show`;
  clearTimeout(window.__alertTimer);
  window.__alertTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3300);
}

function toggleAuth(mode) {
  document.getElementById("loginBox").classList.toggle("hidden", mode !== "login");
  document.getElementById("registerBox").classList.toggle("hidden", mode !== "register");
}

function switchTab(sectionId, navBtn) {
  document.querySelectorAll(".tab-section").forEach((sec) => sec.classList.remove("active"));
  const target = document.getElementById(sectionId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-tab").forEach((btn) => btn.classList.remove("active"));
  if (navBtn && navBtn.classList.contains("nav-tab")) {
    navBtn.classList.add("active");
  } else {
    const match = document.querySelector(`.nav-tab[data-target="${sectionId}"]`);
    if (match) match.classList.add("active");
  }

  if (sectionId === "sec-admin") {
    loadAdminOverview();
  }
}

async function api(path, options = {}) {
  try {
    const token = localStorage.getItem("pdf_session_token") || "";
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { ...options, headers });
    return await res.json();
  } catch (err) {
    return { ok: false, message: "Connection failed. Please try again." };
  }
}

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await api("/api/auth", {
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
  const res = await api("/api/auth", {
    method: "POST",
    body: JSON.stringify({
      mode: "login",
      email,
      password: document.getElementById("loginPassword").value
    })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  localStorage.setItem("pdf_session_token", res.token);
  smartAlert(res.message, "success");
  await enterApp();
});

async function enterApp() {
  const token = localStorage.getItem("pdf_session_token");
  if (!token) return;
  const data = await api("/api/user");
  if (!data.ok) {
    localStorage.removeItem("pdf_session_token");
    return;
  }
  currentUser = data.user;
  plans = data.plans || [];
  transactions = data.transactions || [];
  siteSettings = data.settings || {};
  teamData = data.team || { members: [], total: 0, active: 0, earnings: 0 };
  document.getElementById("authWrap").style.display = "none";
  document.getElementById("appShell").style.display = "block";
  document.getElementById("adminTopBtn").classList.toggle("hidden", !currentUser.is_super_admin);
  renderApp();
  renderPublicSettings();
  startCountdownTicker();
}

function renderApp() {
  if (!currentUser) return;

  const vipLevel = Number(currentUser.vip_level || 0);
  const balance = Number(currentUser.balance_usdt || 0);
  const memberId = currentUser.custom_id || "PDF783516";

  document.getElementById("homeMemberId").textContent = memberId;
  document.getElementById("homeBalanceVal").textContent = `${balance.toFixed(2)} USDT`;
  document.getElementById("profileEmailVal").textContent = currentUser.email;

  const refUrl = `${window.location.origin}/?ref=${encodeURIComponent(memberId)}`;
  document.getElementById("referralLinkInput").value = refUrl;

  let totalDeposit = 0;
  let totalStake = 0;
  let totalReward = 0;

  transactions.forEach((t) => {
    const amt = Number(t.amount_usdt || 0);
    const type = String(t.type || "").toLowerCase();
    if (type.includes("deposit") && t.status === "Approved") totalDeposit += amt;
    if ((type.includes("purchase") || type.includes("upgrade")) && t.status === "Approved") totalStake += amt;
    if ((type.includes("check-in") || type.includes("bonus") || type.includes("refund")) && t.status === "Approved") {
      totalReward += amt;
    }
  });

  document.getElementById("statTotalDeposit").textContent = `${totalDeposit.toFixed(2)} USDT`;
  document.getElementById("statTotalStake").textContent = `${totalStake.toFixed(2)} USDT`;
  document.getElementById("statTotalReward").textContent = `${totalReward.toFixed(2)} USDT`;
  document.getElementById("statMyTeam").textContent = `${teamData.total || 0} Members`;

  document.getElementById("teamTotalMembers").textContent = String(teamData.total || 0);
  document.getElementById("teamActiveMembers").textContent = String(teamData.active || 0);
  document.getElementById("teamDirectRefs").textContent = String(teamData.total || 0);
  document.getElementById("teamEarningsVal").textContent = `${Number(teamData.earnings || 0).toFixed(2)} USDT`;
  document.getElementById("perfEarnings").textContent = `${Number(teamData.earnings || 0).toFixed(2)} USDT`;
  const teamList=document.getElementById("teamMembersList");
  if(teamList) teamList.innerHTML=(teamData.members||[]).map(m=>`<div class="member-slot"><div class="slot-ring">👤</div><span>${escapeHtml(m.fullname)}</span><small>${new Date(m.created_at).toLocaleDateString()}</small></div>`).join("") || `<p class="tx-sub">No referred members yet.</p>`;

  document.getElementById("walletAddress").value = currentUser.wallet_address || "";
  document.getElementById("walletNetwork").value = currentUser.wallet_network || "TRC20";

  // VIP Plans Grid (Matches Home VIP 1 / VIP 2 / VIP 3 style)
  const tierClasses = ["", "tier-blue", "tier-gold"];
  const wreathIcons = ["👑", "🥈", "🏆"];

  const renderPlanCardsHtml = (list) => {
    if (!list.length) return `<p class="tx-sub">No VIP plans yet.</p>`;
    return list
      .map((p, idx) => {
        const lvl = Number(p.vip_level);
        const isCurrent = lvl === vipLevel;
        const disabled = lvl <= vipLevel;
        const tierCls = tierClasses[idx % 3] || "";
        const ico = wreathIcons[idx % 3] || "👑";
        return `
          <div class="vip-card-item ${tierCls}">
            <div>
              <div class="vip-pill-head">${escapeHtml(p.title || `VIP ${lvl}`)}</div>
              <div class="vip-wreath-icon">${ico}</div>
              <div class="vip-price-big">${Number(p.price_usdt).toFixed(2)} USDT</div>
              <div class="vip-line-meta">
                Indicative daily projection (not guaranteed): ${Number(p.daily_usdt).toFixed(2)} USDT<br />
                Duration: ${Number(p.duration_days)} Days
              </div>
            </div>
            <button
              type="button"
              class="vip-upgrade-btn"
              ${disabled ? "disabled" : ""}
              onclick="buyVip(${lvl})"
            >
              ${isCurrent ? "Active" : disabled ? "Lower Tier" : "Upgrade Now &gt;"}
            </button>
          </div>
        `;
      })
      .join("");
  };

  document.getElementById("homeVipGrid").innerHTML = renderPlanCardsHtml(plans.slice(0, 3));
  document.getElementById("allVipPlansContainer").innerHTML = renderPlanCardsHtml(plans);

  // Products Tab Current Product
  const activePlan = plans.find((x) => Number(x.vip_level) === vipLevel);
  if (vipLevel > 0 && activePlan) {
    document.getElementById("prodActiveTitle").textContent = activePlan.title || `VIP ${vipLevel}`;
    document.getElementById("prodActivePrice").textContent = `${Number(activePlan.price_usdt).toFixed(2)} USDT`;
    document.getElementById("prodDuration").textContent = `${Number(activePlan.duration_days)} Days`;
    document.getElementById("prodDailyVal").textContent = `${Number(activePlan.daily_usdt).toFixed(2)} USDT`;

    const daysLeft = currentUser.vip_expires_at
      ? Math.max(0, Math.ceil((Number(currentUser.vip_expires_at) - Date.now()) / (1000 * 60 * 60 * 24)))
      : Number(activePlan.duration_days);
    document.getElementById("prodDaysLeft").textContent = `${daysLeft} Days`;
  } else {
    document.getElementById("prodActiveTitle").textContent = "VIP 0";
    document.getElementById("prodActivePrice").textContent = "Free Trial";
    document.getElementById("prodDuration").textContent = "3 Days";
    document.getElementById("prodDailyVal").textContent = `${Number(siteSettings.checkin_reward ?? 0.2).toFixed(2)} USDT`;
    document.getElementById("prodDaysLeft").textContent = "3 Days";
  }

  document.getElementById("prodStartDate").textContent = new Date(
    Number(currentUser.created_at || Date.now())
  ).toLocaleDateString();
  document.getElementById("prodTotalEarnings").textContent = `${totalReward.toFixed(2)} USDT`;
  document.getElementById("prodTotalDeposit").textContent = `${totalDeposit.toFixed(2)} USDT`;

  // History List
  const histBox = document.getElementById("txHistoryList");
  if (!transactions.length) {
    histBox.innerHTML = `<p class="tx-sub">No transactions yet.</p>`;
  } else {
    histBox.innerHTML = transactions
      .map(
        (t) => `
          <div class="tx-row">
            <div>
              <strong>${escapeHtml(t.type)}</strong>
              <div class="tx-sub">${escapeHtml(t.details || "")} • ${new Date(t.created_at).toLocaleString()}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:900; color:var(--neon-green);">${Number(t.amount_usdt || 0).toFixed(2)} USDT</div>
              <span class="st-badge ${t.status}">${t.status}</span>
            </div>
          </div>
        `
      )
      .join("");
  }
}

function setExternalLink(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  if (url && /^https:\/\//i.test(url)) { el.href = url; el.classList.remove("hidden"); }
  else { el.href = "#"; el.classList.add("hidden"); }
}

function renderPublicSettings() {
  const cfg = siteSettings || {};
  const banner = document.getElementById("heroBannerImg");
  if (banner) {
    if (cfg.banner_key) { banner.src = `/media/${cfg.banner_key}`; banner.classList.remove("hidden"); }
    else { banner.removeAttribute("src"); banner.classList.add("hidden"); }
  }
  const brand = document.querySelectorAll(".brand-name");
  brand.forEach(el => { el.innerHTML = `${escapeHtml(cfg.company_name || "Prime Digital Finance")} <span>(${escapeHtml(cfg.brand_short || "PDF")})</span>`; });
  const heroTitle=document.getElementById("heroTitle"); if(heroTitle) heroTitle.textContent=cfg.hero_title || "PRIME DIGITAL FINANCE";
  const heroSubtitle=document.getElementById("heroSubtitle"); if(heroSubtitle) heroSubtitle.textContent=cfg.hero_subtitle || "Your account. Your transactions. Clear records.";
  const tagline = document.querySelectorAll(".brand-tagline");
  tagline.forEach(el => el.textContent = cfg.tagline || "FINANCE • TRANSPARENCY • CONTROL");
  const ann = document.getElementById("announcementText"); if (ann) ann.textContent = cfg.announcement || "Welcome to Prime Digital Finance.";
  const faq = document.querySelector("#faqPanel p"); if (faq) faq.textContent = cfg.faq_text || "Contact support if you need help with a payment or account.";
  setExternalLink("liveChatLink", cfg.live_chat_url);
  setExternalLink("supportChatLink", cfg.live_chat_url);
  setExternalLink("telegramChannelLink", cfg.telegram_url);
  setExternalLink("whatsappChannelLink", cfg.whatsapp_url);
  const net = document.getElementById("depositNetworkLabel"); if (net) net.textContent = cfg.deposit_network || "TRC20";
  const addr = document.getElementById("depositAddressLabel"); if (addr) addr.textContent = cfg.deposit_address || "Admin has not configured a deposit wallet.";
  const instructions = document.getElementById("depositInstructionsLabel"); if (instructions) instructions.textContent = cfg.deposit_instructions || "Please contact support for deposit instructions.";
  const limits=document.getElementById("depositLimitsLabel"); if(limits) limits.textContent=`${cfg.deposit_min||1}–${cfg.deposit_max||5000} USDT`;
  const withdrawHeading=document.getElementById("withdrawHeading"); if(withdrawHeading) withdrawHeading.textContent=`Withdraw USDT (Minimum ${cfg.withdraw_min||2} USDT)`;
  const withdrawAmount=document.getElementById("withdrawAmount"); if(withdrawAmount) withdrawAmount.min=cfg.withdraw_min||2;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function startCountdownTicker() {
  if (countdownInterval) clearInterval(countdownInterval);
  const updateClock = () => {
    const el = document.getElementById("countdownClock");
    const btn = document.getElementById("prodCheckinBtn");
    if (!el || !currentUser) return;

    const twentyFourHours = 24 * 60 * 60 * 1000;
    const lastMs = Number(currentUser.last_checkin_ms || 0);
    const elapsed = Date.now() - lastMs;

    if (lastMs && elapsed < twentyFourHours) {
      const remSec = Math.max(0, Math.floor((twentyFourHours - elapsed) / 1000));
      const hrs = String(Math.floor(remSec / 3600)).padStart(2, "0");
      const mins = String(Math.floor((remSec % 3600) / 60)).padStart(2, "0");
      const secs = String(remSec % 60).padStart(2, "0");
      el.textContent = `${hrs}:${mins}:${secs}`;
      if (btn) btn.disabled = true;
    } else {
      el.textContent = "00:00:00";
      if (btn) btn.disabled = false;
    }
  };
  updateClock();
  countdownInterval = setInterval(updateClock, 1000);
}

function openDepositBox() {
  const drawer=document.getElementById("depositDrawer");
  drawer.classList.remove("hidden");
  document.getElementById("depositInput").focus();
}
function goToDeposit() {
  switchTab("sec-home");
  openDepositBox();
}

async function submitQuickDeposit() {
  const amount = Number(document.getElementById("depositInput").value);
  const proof = document.getElementById("depositProof").files[0];
  if (!proof) return smartAlert("Please upload your payment screenshot.", "error");
  const form = new FormData();
  form.append("amount", String(amount));
  form.append("network", siteSettings.deposit_network || "TRC20");
  form.append("tx_reference", document.getElementById("depositTxRef").value.trim());
  form.append("proof", proof);
  const res = await api("/api/deposit", { method: "POST", body: form });
  if (!res.ok) return smartAlert(res.message, "error");
  document.getElementById("depositInput").value = "";
  document.getElementById("depositTxRef").value = "";
  document.getElementById("depositProof").value = "";
  document.getElementById("depositDrawer").classList.add("hidden");
  smartAlert(res.message, "success");
  await enterApp();
}
function copyDepositAddress() {
  const value = document.getElementById("depositAddressLabel").textContent;
  if (!value || value.includes("not configured")) return smartAlert("Deposit wallet has not been configured.", "error");
  navigator.clipboard?.writeText(value).then(() => smartAlert("Deposit address copied.", "success")).catch(() => smartAlert("Could not copy address.", "error"));
}

async function buyVip(vip) {
  const res = await api("/api/buy-vip", {
    method: "POST",
    body: JSON.stringify({ email: currentUser.email, vip })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await enterApp();
}

async function claimDailyReward() {
  const res = await api("/api/checkin", {
    method: "POST",
    body: JSON.stringify({ email: currentUser.email })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await enterApp();
}

function copyMemberId() {
  const idText = document.getElementById("homeMemberId").textContent;
  navigator.clipboard?.writeText(idText).catch(() => {});
  smartAlert(`Copied Member ID: ${idText}`, "success");
}

function copyReferralLink() {
  const link = document.getElementById("referralLinkInput").value;
  navigator.clipboard?.writeText(link).catch(() => {});
  smartAlert("Referral link copied!", "success");
}

function shareReferral(channel) {
  const link = encodeURIComponent(document.getElementById("referralLinkInput").value);
  const text = encodeURIComponent("Explore Prime Digital Finance (PDF): ");
  const url =
    channel === "whatsapp"
      ? `https://wa.me/?text=${text}${link}`
      : `https://t.me/share/url?url=${link}&text=${text}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function toggleFaqBox() {
  document.getElementById("faqPanel").classList.toggle("hidden");
}

function scrollToAllPlans() {
  document.getElementById("allVipPlansContainer").scrollIntoView({ behavior: "smooth" });
}

async function saveWalletAddress() {
  const res = await api("/api/payment-method", {
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

async function saveSecurityPin() {
  const res = await api("/api/security-pin", {
    method: "POST",
    body: JSON.stringify({
      email: currentUser.email,
      pin: document.getElementById("newPin").value
    })
  });
  if (res.ok) document.getElementById("newPin").value = "";
  smartAlert(res.message, res.ok ? "success" : "error");
}

async function submitWithdrawal() {
  const res = await api("/api/withdraw", {
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

async function loadAdminOverview() {
  if (!currentUser || !currentUser.is_super_admin) return;
  const data = await api("/api/admin/overview");
  if (!data.ok) return smartAlert(data.message, "error");
  const adminPlans = data.plans || []; window.__adminPlans = adminPlans;
  document.getElementById("adminPlansContainer").innerHTML = adminPlans.map((p, idx) => `
    <div class="tx-row"><div><strong>${escapeHtml(p.title)} (Level ${p.vip_level})</strong><div class="tx-sub">Price: ${Number(p.price_usdt).toFixed(2)} USDT • Indicative daily figure: ${Number(p.daily_usdt).toFixed(2)} USDT • ${Number(p.duration_days)} days</div></div><div class="tx-btns"><button type="button" class="mini-action-btn" onclick="editAdminPlan(${idx})">Edit</button><button type="button" class="mini-action-btn" onclick="deleteAdminPlan(${Number(p.vip_level)})">Delete</button></div></div>`).join("") || `<p class="tx-sub">No products configured.</p>`;
  const cfg = data.settings || {};
  const fields = {cfgCompanyName:"company_name",cfgBrandShort:"brand_short",cfgTagline:"tagline",cfgHeroTitle:"hero_title",cfgHeroSubtitle:"hero_subtitle",cfgDepositAddress:"deposit_address",cfgDepositNetwork:"deposit_network",cfgDepositMin:"deposit_min",cfgDepositMax:"deposit_max",cfgWithdrawMin:"withdraw_min",cfgCheckinReward:"checkin_reward",cfgDepositInstructions:"deposit_instructions",cfgLiveChat:"live_chat_url",cfgTelegram:"telegram_url",cfgWhatsapp:"whatsapp_url",cfgAnnouncement:"announcement",cfgFaq:"faq_text"};
  for (const [id,key] of Object.entries(fields)) { const el=document.getElementById(id); if(el) el.value=cfg[key] ?? ""; }
  window.__adminAccounts = data.super_admins || [];
  document.getElementById("superAdminsContainer").innerHTML = window.__adminAccounts.map((a,idx)=>`<div class="tx-row"><div><strong>${escapeHtml(a.email)}</strong><div class="tx-sub">Added by: ${escapeHtml(a.added_by)}</div></div><div class="tx-btns"><span class="st-badge Approved">${escapeHtml(a.role)}</span>${a.email.toLowerCase()!==currentUser.email.toLowerCase()?`<button class="mini-action-btn" onclick="removeSuperAdminAt(${idx})">Remove</button>`:""}</div></div>`).join("");
  document.getElementById("pendingWithdrawalsContainer").innerHTML = (data.pending_withdrawals||[]).map(w=>`<div class="tx-row"><div><strong>#${w.id} • ${escapeHtml(w.user_email)}</strong><div class="tx-sub">${Number(w.amount_usdt).toFixed(2)} USDT</div><div class="tx-sub">${escapeHtml(w.details||"")}</div></div><div class="tx-btns"><button class="mini-action-btn" onclick="decideWithdrawal(${w.id},'Approved')">Approve</button><button class="mini-action-btn" onclick="decideWithdrawal(${w.id},'Rejected')">Reject</button></div></div>`).join("") || `<p class="tx-sub">No pending withdrawals.</p>`;
  document.getElementById("adminMembersContainer").innerHTML = (data.recent_users||[]).map(u=>`<div class="tx-row"><div><strong>${escapeHtml(u.fullname)}</strong><div class="tx-sub">${escapeHtml(u.custom_id)} • ${escapeHtml(u.email)}</div></div><strong>${Number(u.balance_usdt).toFixed(2)} USDT</strong></div>`).join("") || `<p class="tx-sub">No members yet.</p>`;
  const deposits = data.pending_deposits || [];
  const box = document.getElementById("pendingDepositsContainer");
  box.innerHTML = deposits.map(d=>`<div class="admin-review-row"><strong>Deposit #${d.id} • ${escapeHtml(d.user_email)}</strong><div class="tx-sub">${Number(d.amount_usdt).toFixed(2)} USDT • ${escapeHtml(d.network)} • ${new Date(d.created_at).toLocaleString()}</div><div class="tx-sub">Reference: ${escapeHtml(d.tx_reference||"Not supplied")}</div><div id="proof-${d.id}" class="tx-sub">Loading payment proof…</div><input id="deposit-note-${d.id}" placeholder="Optional review note" /><div class="admin-review-actions"><button class="approve" onclick="reviewDeposit(${d.id},'Approved')">Approve & Credit</button><button class="reject" onclick="reviewDeposit(${d.id},'Rejected')">Reject</button></div></div>`).join("") || `<p class="tx-sub">No pending deposit requests.</p>`;
  for (const d of deposits) loadDepositProof(d.id);
}
async function loadDepositProof(id) {
  const token=localStorage.getItem("pdf_session_token");
  try { const res=await fetch(`/api/admin/deposit-proof/${id}`,{headers:{Authorization:`Bearer ${token}`}}); if(!res.ok) throw new Error(); const blob=await res.blob(); const url=URL.createObjectURL(blob); const box=document.getElementById(`proof-${id}`); if(box) box.innerHTML=`<img src="${url}" alt="Payment proof for deposit ${id}" />`; }
  catch { const box=document.getElementById(`proof-${id}`); if(box) box.textContent="Unable to load proof image."; }
}
async function reviewDeposit(requestId, decision) {
  const note=document.getElementById(`deposit-note-${requestId}`)?.value||"";
  const res=await api("/api/admin/deposit-action",{method:"POST",body:JSON.stringify({requestId,decision,note})});
  smartAlert(res.message,res.ok?"success":"error");
  if(res.ok){await loadAdminOverview();await enterApp();}
}
async function savePlatformSettings() {
  const values={company_name:"cfgCompanyName",brand_short:"cfgBrandShort",tagline:"cfgTagline",hero_title:"cfgHeroTitle",hero_subtitle:"cfgHeroSubtitle",deposit_address:"cfgDepositAddress",deposit_network:"cfgDepositNetwork",deposit_min:"cfgDepositMin",deposit_max:"cfgDepositMax",withdraw_min:"cfgWithdrawMin",checkin_reward:"cfgCheckinReward",deposit_instructions:"cfgDepositInstructions",live_chat_url:"cfgLiveChat",telegram_url:"cfgTelegram",whatsapp_url:"cfgWhatsapp",announcement:"cfgAnnouncement",faq_text:"cfgFaq"};
  const body={}; for(const [key,id] of Object.entries(values)) body[key]=document.getElementById(id).value;
  const res=await api("/api/admin/settings",{method:"POST",body:JSON.stringify(body)}); smartAlert(res.message,res.ok?"success":"error"); if(res.ok){await loadAdminOverview();await enterApp();}
}
async function uploadHomeBanner() {
  const file=document.getElementById("cfgBannerFile").files[0]; if(!file) return smartAlert("Choose a banner image first.","error");
  const form=new FormData(); form.append("banner",file); const res=await api("/api/admin/banner",{method:"POST",body:form}); smartAlert(res.message,res.ok?"success":"error"); if(res.ok){document.getElementById("cfgBannerFile").value="";await loadAdminOverview();await enterApp();}
}

function editAdminPlan(idx) {
  const p = (window.__adminPlans || [])[idx];
  if (!p) return;
  document.getElementById("adminPlanLevel").value = p.vip_level;
  document.getElementById("adminPlanTitle").value = p.title;
  document.getElementById("adminPlanPrice").value = p.price_usdt;
  document.getElementById("adminPlanDaily").value = p.daily_usdt;
  document.getElementById("adminPlanDuration").value = p.duration_days;
}

async function saveAdminPlan() {
  const lvl = Number(document.getElementById("adminPlanLevel").value);
  const res = await api("/api/admin/upsert-plan", {
    method: "POST",
    body: JSON.stringify({
      adminEmail: currentUser.email,
      vip_level: lvl,
      title: (document.getElementById("adminPlanTitle").value || `VIP ${lvl}`).trim(),
      price_usdt: Number(document.getElementById("adminPlanPrice").value),
      daily_usdt: Number(document.getElementById("adminPlanDaily").value),
      duration_days: Number(document.getElementById("adminPlanDuration").value)
    })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) {
    await loadAdminOverview();
    await enterApp();
  }
}

async function deleteAdminPlan(vipLevel) {
  const res = await api("/api/admin/delete-plan", {
    method: "POST",
    body: JSON.stringify({ adminEmail: currentUser.email, vip_level: vipLevel })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) {
    await loadAdminOverview();
    await enterApp();
  }
}

async function saveAdminTgIds() { smartAlert("Use Website Control to set your Telegram channel URL.", "info"); }

async function addNewSuperAdmin() {
  const res = await api("/api/admin/add-super-admin", {
    method: "POST",
    body: JSON.stringify({
      adminEmail: currentUser.email,
      newAdminEmail: document.getElementById("newSuperAdminInput").value
    })
  });
  if (res.ok) document.getElementById("newSuperAdminInput").value = "";
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}

async function removeSuperAdminAt(index) {
  const email=(window.__adminAccounts||[])[index]?.email; if(!email) return;
  if(!confirm(`Remove Super Admin access for ${email}?`)) return;
  const res=await api("/api/admin/remove-super-admin",{method:"POST",body:JSON.stringify({email})});
  smartAlert(res.message,res.ok?"success":"error"); if(res.ok) await loadAdminOverview();
}
async function decideWithdrawal(txId, decision) {
  const res = await api("/api/admin/withdrawal-action", {
    method: "POST",
    body: JSON.stringify({ adminEmail: currentUser.email, txId, decision })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) {
    await loadAdminOverview();
    await enterApp();
  }
}

async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  localStorage.removeItem("pdf_session_token");
  location.reload();
}

window.addEventListener("DOMContentLoaded", enterApp);
                          

let plans = [];
let currentUser = null;
let transactions = [];
let countdownInterval = null;

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
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
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
  localStorage.setItem("pdf_usdt_email", email);
  smartAlert(res.message, "success");
  await enterApp();
});

async function enterApp() {
  const email = localStorage.getItem("pdf_usdt_email");
  if (!email) return;

  const data = await api(`/api/user?email=${encodeURIComponent(email)}`);
  if (!data.ok) {
    localStorage.removeItem("pdf_usdt_email");
    return;
  }

  currentUser = data.user;
  plans = data.plans || [];
  transactions = data.transactions || [];

  document.getElementById("authWrap").style.display = "none";
  document.getElementById("appShell").style.display = "block";
  document.getElementById("adminTopBtn").classList.toggle("hidden", !currentUser.is_super_admin);

  renderApp();
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
  document.getElementById("statMyTeam").textContent = "0 Members";

  document.getElementById("teamTotalMembers").textContent = "0";
  document.getElementById("teamActiveMembers").textContent = "0";
  document.getElementById("teamDirectRefs").textContent = "0";
  document.getElementById("teamEarningsVal").textContent = "0.00 USDT";
  document.getElementById("perfEarnings").textContent = "0.00 USDT";

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
              <div class="vip-pill-head">${p.title || `VIP ${lvl}`}</div>
              <div class="vip-wreath-icon">${ico}</div>
              <div class="vip-price-big">${Number(p.price_usdt).toFixed(2)} USDT</div>
              <div class="vip-line-meta">
                Daily Yield: ${Number(p.daily_usdt).toFixed(2)} USDT<br />
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
    document.getElementById("prodDailyVal").textContent = "0.20 USDT";
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
              <strong>${t.type}</strong>
              <div class="tx-sub">${t.details || ""} • ${new Date(t.created_at).toLocaleString()}</div>
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
  document.getElementById("depositDrawer").classList.toggle("hidden");
  document.getElementById("depositInput").focus();
}

async function submitQuickDeposit() {
  const amount = Number(document.getElementById("depositInput").value);
  const res = await api("/api/deposit", {
    method: "POST",
    body: JSON.stringify({ email: currentUser.email, amount })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  document.getElementById("depositInput").value = "";
  document.getElementById("depositDrawer").classList.add("hidden");
  smartAlert(res.message, "success");
  await enterApp();
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
  const text = encodeURIComponent("Join PDF USDT and earn daily rewards: ");
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
  const data = await api(`/api/admin/overview?adminEmail=${encodeURIComponent(currentUser.email)}`);
  if (!data.ok) return smartAlert(data.message, "error");

  const adminPlans = data.plans || [];
  window.__adminPlans = adminPlans;
  document.getElementById("adminPlansContainer").innerHTML = adminPlans.length
    ? adminPlans
        .map(
          (p, idx) => `
            <div class="tx-row">
              <div>
                <strong>${p.title} (Level ${p.vip_level})</strong>
                <div class="tx-sub" style="color:var(--neon-green);">
                  Price: ${Number(p.price_usdt).toFixed(2)} USDT • Daily: ${Number(p.daily_usdt).toFixed(2)} USDT • ${Number(p.duration_days)} Days
                </div>
              </div>
              <div class="tx-btns">
                <button type="button" class="mini-action-btn" onclick="editAdminPlan(${idx})">Edit</button>
                <button type="button" class="mini-action-btn" onclick="deleteAdminPlan(${Number(p.vip_level)})">Delete</button>
              </div>
            </div>
          `
        )
        .join("")
    : `<p class="tx-sub">No VIP plans configured.</p>`;

  document.getElementById("adminTgIds").value = data.telegram_chat_ids || "";

  document.getElementById("superAdminsContainer").innerHTML = (data.super_admins || [])
    .map(
      (a) => `
        <div class="tx-row">
          <div>
            <strong>${a.email}</strong>
            <div class="tx-sub">Added by: ${a.added_by}</div>
          </div>
          <span class="st-badge Approved">${a.role}</span>
        </div>
      `
    )
    .join("");

  const pendings = data.pending_withdrawals || [];
  document.getElementById("pendingWithdrawalsContainer").innerHTML = pendings.length
    ? pendings
        .map(
          (w) => `
            <div class="tx-row">
              <div>
                <strong>#${w.id} • ${w.user_email}</strong>
                <div class="tx-sub" style="color:var(--neon-green);">${Number(w.amount_usdt).toFixed(2)} USDT</div>
                <div class="tx-sub">${w.details || ""}</div>
              </div>
              <div class="tx-btns">
                <button type="button" class="mini-action-btn" onclick="decideWithdrawal(${w.id}, 'Approved')">Approve</button>
                <button type="button" class="mini-action-btn" onclick="decideWithdrawal(${w.id}, 'Rejected')">Reject</button>
              </div>
            </div>
          `
        )
        .join("")
    : `<p class="tx-sub">No pending withdrawals.</p>`;
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

async function saveAdminTgIds() {
  const res = await api("/api/admin/settings", {
    method: "POST",
    body: JSON.stringify({
      adminEmail: currentUser.email,
      telegram_chat_ids: document.getElementById("adminTgIds").value
    })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await loadAdminOverview();
}

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

function logout() {
  localStorage.removeItem("pdf_usdt_email");
  location.reload();
}

window.addEventListener("DOMContentLoaded", enterApp);
                          

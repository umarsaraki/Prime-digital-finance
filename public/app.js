let plans = [];
let currentUser = null;
let transactions = [];

function smartAlert(message, type = "info") {
  const alertEl = document.getElementById("smartAlert");
  const cleanText = String(message || "Action completed.").slice(0, 140);
  alertEl.textContent = cleanText;
  alertEl.className = `smart-alert ${type} show`;
  clearTimeout(window.__smartAlertTimer);
  window.__smartAlertTimer = setTimeout(() => {
    alertEl.classList.remove("show");
  }, 3400);
}

function toggleAuth(mode) {
  document.getElementById("loginBox").classList.toggle("hidden", mode !== "login");
  document.getElementById("registerBox").classList.toggle("hidden", mode !== "register");
}

function switchSection(sectionId, triggerBtn) {
  document.querySelectorAll(".section").forEach((sec) => sec.classList.remove("active"));
  const targetSec = document.getElementById(sectionId);
  if (targetSec) targetSec.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.remove("active"));
  if (triggerBtn && triggerBtn.classList.contains("nav-item")) {
    triggerBtn.classList.add("active");
  } else {
    const matchedNav = document.querySelector(`.nav-item[data-target="${sectionId}"]`);
    if (matchedNav) matchedNav.classList.add("active");
  }

  if (sectionId === "sec-admin") {
    loadAdminOverview();
  }
}

async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(endpoint, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    return await response.json();
  } catch (err) {
    return { ok: false, message: "Unable to connect to server." };
  }
}

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await apiRequest("/api/auth", {
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
  const res = await apiRequest("/api/auth", {
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
  await hydrateApp();
});

async function hydrateApp() {
  const savedEmail = localStorage.getItem("pdf_usdt_email");
  if (!savedEmail) return;

  const data = await apiRequest(`/api/user?email=${encodeURIComponent(savedEmail)}`);
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

  renderDashboard();
}

function renderDashboard() {
  if (!currentUser) return;

  const vipLevel = Number(currentUser.vip_level || 0);
  const balance = Number(currentUser.balance_usdt || 0).toFixed(2);

  document.getElementById("topUserEmail").textContent = currentUser.email;
  document.getElementById("statId").textContent = currentUser.custom_id;
  document.getElementById("statVip").textContent = `VIP ${vipLevel}`;
  document.getElementById("balanceUsdt").textContent = `${balance} USDT`;
  document.getElementById("walletAddress").value = currentUser.wallet_address || "";
  document.getElementById("walletNetwork").value = currentUser.wallet_network || "TRC20";

  const vipGrid = document.getElementById("vipGrid");
  if (!plans.length) {
    vipGrid.innerHTML = `<p class="row-sub">No VIP plans configured yet.</p>`;
  } else {
    vipGrid.innerHTML = plans
      .map((plan) => {
        const level = Number(plan.vip_level);
        const isCurrent = level === vipLevel;
        const isLowerOrEqual = level <= vipLevel;
        const title = plan.title || `VIP ${level}`;

        return `
          <div class="plan-card ${isCurrent ? "active" : ""}">
            <div>
              <div class="plan-name">${title}</div>
              <div class="plan-price">${Number(plan.price_usdt).toFixed(2)} USDT</div>
              <div class="plan-meta">Daily Yield: ${Number(plan.daily_usdt).toFixed(2)} USDT</div>
              <div class="plan-duration">Duration: ${Number(plan.duration_days)} Days</div>
            </div>
            <button
              type="button"
              class="btn btn-primary"
              ${isLowerOrEqual ? "disabled" : ""}
              onclick="buyVip(${level})"
            >
              ${isCurrent ? "Active Plan" : isLowerOrEqual ? "Unavailable" : `Upgrade to ${title}`}
            </button>
          </div>
        `;
      })
      .join("");
  }

  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const vip0Active = Date.now() - Number(currentUser.created_at || Date.now()) < threeDaysMs;
  let activePackagesHtml = "";

  if (vip0Active) {
    activePackagesHtml += `
      <div class="list-row">
        <div>
          <strong>VIP 0 Welcome Bonus</strong>
          <div class="row-sub">3-Day Trial Yield: 0.50 USDT / day</div>
        </div>
        <span class="badge Approved">Active</span>
      </div>
    `;
  }

  const activePlan = plans.find((item) => Number(item.vip_level) === vipLevel);
  if (vipLevel > 0 && activePlan) {
    const expiryLabel = currentUser.vip_expires_at
      ? `Expires: ${new Date(Number(currentUser.vip_expires_at)).toLocaleDateString()}`
      : `Duration: ${Number(activePlan.duration_days)} Days`;

    activePackagesHtml += `
      <div class="list-row">
        <div>
          <strong>${activePlan.title || `VIP ${vipLevel}`}</strong>
          <div class="row-sub">Daily Yield: ${Number(activePlan.daily_usdt).toFixed(2)} USDT • ${expiryLabel}</div>
        </div>
        <span class="badge Approved">Purchased</span>
      </div>
    `;
  }

  document.getElementById("activePackagesBox").innerHTML =
    activePackagesHtml || `<p class="row-sub">No active packages right now.</p>`;

  const checkinBtn = document.getElementById("checkinBtn");
  const twentyFourHours = 24 * 60 * 60 * 1000;
  const lastCheckin = Number(currentUser.last_checkin_ms || 0);
  if (lastCheckin && Date.now() - lastCheckin < twentyFourHours) {
    const hoursLeft = Math.ceil((twentyFourHours - (Date.now() - lastCheckin)) / (1000 * 60 * 60));
    checkinBtn.disabled = true;
    checkinBtn.textContent = `Claimed Today • Next in ${hoursLeft}h`;
  } else {
    checkinBtn.disabled = false;
    checkinBtn.textContent = "Claim +0.20 USDT";
  }

  const historyBox = document.getElementById("historyContainer");
  if (!transactions.length) {
    historyBox.innerHTML = `<p class="row-sub">No transactions recorded yet.</p>`;
  } else {
    historyBox.innerHTML = transactions
      .map(
        (tx) => `
          <div class="list-row">
            <div>
              <strong>${tx.type}</strong>
              <div class="row-sub">${tx.details || ""}</div>
              <div class="row-sub">${new Date(tx.created_at).toLocaleString()}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:800; color:var(--usdt-mint);">${Number(tx.amount_usdt || 0).toFixed(2)} USDT</div>
              <span class="badge ${tx.status}">${tx.status}</span>
            </div>
          </div>
        `
      )
      .join("");
  }
}

function populatePlanEditor(plan) {
  document.getElementById("planLevel").value = plan.vip_level;
  document.getElementById("planTitle").value = plan.title;
  document.getElementById("planPrice").value = plan.price_usdt;
  document.getElementById("planDaily").value = plan.daily_usdt;
  document.getElementById("planDuration").value = plan.duration_days;
}

async function saveVipPlan() {
  const level = Number(document.getElementById("planLevel").value);
  const title = (document.getElementById("planTitle").value || `VIP ${level}`).trim();
  const priceUsdt = Number(document.getElementById("planPrice").value);
  const dailyUsdt = Number(document.getElementById("planDaily").value);
  const durationDays = Number(document.getElementById("planDuration").value);

  const res = await apiRequest("/api/admin/upsert-plan", {
    method: "POST",
    body: JSON.stringify({
      adminEmail: currentUser.email,
      vip_level: level,
      title,
      price_usdt: priceUsdt,
      daily_usdt: dailyUsdt,
      duration_days: durationDays
    })
  });

  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) {
    await loadAdminOverview();
    await hydrateApp();
  }
}

async function deleteVipPlan(vipLevel) {
  const res = await apiRequest("/api/admin/delete-plan", {
    method: "POST",
    body: JSON.stringify({
      adminEmail: currentUser.email,
      vip_level: vipLevel
    })
  });

  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) {
    await loadAdminOverview();
    await hydrateApp();
  }
}

async function loadAdminOverview() {
  if (!currentUser || !currentUser.is_super_admin) return;
  const data = await apiRequest(`/api/admin/overview?adminEmail=${encodeURIComponent(currentUser.email)}`);
  if (!data.ok) return smartAlert(data.message, "error");

  const adminPlans = data.plans || [];
  window.__adminPlansCache = adminPlans;

  const adminPlansList = document.getElementById("adminPlansList");
  if (!adminPlans.length) {
    adminPlansList.innerHTML = `<p class="row-sub">No VIP plans yet. Add one above.</p>`;
  } else {
    adminPlansList.innerHTML = adminPlans
      .map(
        (plan, index) => `
          <div class="list-row">
            <div>
              <strong>${plan.title} (Level ${plan.vip_level})</strong>
              <div class="row-sub" style="color:var(--usdt-mint);">
                Price: ${Number(plan.price_usdt).toFixed(2)} USDT • Daily: ${Number(plan.daily_usdt).toFixed(2)} USDT • Duration: ${Number(plan.duration_days)} Days
              </div>
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-secondary btn-sm" onclick="editAdminPlan(${index})">Edit</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="deleteVipPlan(${Number(plan.vip_level)})">Delete</button>
            </div>
          </div>
        `
      )
      .join("");
  }

  document.getElementById("adminTelegramIds").value = data.telegram_chat_ids || "";

  const adminsList = document.getElementById("superAdminsList");
  adminsList.innerHTML = (data.super_admins || [])
    .map(
      (admin) => `
        <div class="list-row">
          <div>
            <strong>${admin.email}</strong>
            <div class="row-sub">Added by: ${admin.added_by}</div>
          </div>
          <span class="badge Approved">${admin.role}</span>
        </div>
      `
    )
    .join("");

  const pendingList = document.getElementById("pendingWithdrawalsList");
  const pendings = data.pending_withdrawals || [];
  if (!pendings.length) {
    pendingList.innerHTML = `<p class="row-sub">No pending withdrawals.</p>`;
  } else {
    pendingList.innerHTML = pendings
      .map(
        (item) => `
          <div class="list-row">
            <div>
              <strong>#${item.id} • ${item.user_email}</strong>
              <div class="row-sub" style="color:var(--usdt-mint);">${Number(item.amount_usdt).toFixed(2)} USDT</div>
              <div class="row-sub">${item.details || ""}</div>
            </div>
            <div class="row-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="decideWithdrawal(${item.id}, 'Approved')">Approve</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="decideWithdrawal(${item.id}, 'Rejected')">Reject</button>
            </div>
          </div>
        `
      )
      .join("");
  }
}

function editAdminPlan(index) {
  const list = window.__adminPlansCache || [];
  if (list[index]) populatePlanEditor(list[index]);
}

async function saveTelegramSettings() {
  const res = await apiRequest("/api/admin/settings", {
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
  const res = await apiRequest("/api/admin/add-super-admin", {
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
  const res = await apiRequest("/api/admin/withdrawal-action", {
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
    await hydrateApp();
  }
}

async function quickDeposit() {
  const amount = Number(document.getElementById("depositAmount").value);
  const res = await apiRequest("/api/deposit", {
    method: "POST",
    body: JSON.stringify({ email: currentUser.email, amount })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  document.getElementById("depositAmount").value = "";
  smartAlert(res.message, "success");
  await hydrateApp();
}

async function buyVip(vip) {
  const res = await apiRequest("/api/buy-vip", {
    method: "POST",
    body: JSON.stringify({ email: currentUser.email, vip })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await hydrateApp();
}

async function claimCheckin() {
  const res = await apiRequest("/api/checkin", {
    method: "POST",
    body: JSON.stringify({ email: currentUser.email })
  });
  if (!res.ok) return smartAlert(res.message, "error");
  smartAlert(res.message, "success");
  await hydrateApp();
}

async function saveWallet() {
  const res = await apiRequest("/api/payment-method", {
    method: "POST",
    body: JSON.stringify({
      email: currentUser.email,
      wallet_network: document.getElementById("walletNetwork").value,
      wallet_address: document.getElementById("walletAddress").value
    })
  });
  smartAlert(res.message, res.ok ? "success" : "error");
  if (res.ok) await hydrateApp();
}

async function savePin() {
  const res = await apiRequest("/api/security-pin", {
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
  const res = await apiRequest("/api/withdraw", {
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
  await hydrateApp();
}

function logout() {
  localStorage.removeItem("pdf_usdt_email");
  location.reload();
}

window.addEventListener("DOMContentLoaded", hydrateApp);

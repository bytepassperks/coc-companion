const apiBase = document.querySelector("#apiBase");
const playerTag = document.querySelector("#playerTag");
const toast = document.querySelector("#toast");
const profileHeader = document.querySelector("#profileHeader");
const accountDetails = document.querySelector("#accountDetails");
const planHeadline = document.querySelector("#planHeadline");
const planText = document.querySelector("#planText");
const actions = document.querySelector("#actions");
const completion = document.querySelector("#completion");
const warStats = document.querySelector("#warStats");
const clanStats = document.querySelector("#clanStats");
const capitalStats = document.querySelector("#capitalStats");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authStatus = document.querySelector("#authStatus");
const logoutButton = document.querySelector("#logout");
const completedActions = document.querySelector("#completedActions");
const completedList = document.querySelector("#completedList");
const todayNextUpgrade = document.querySelector("#todayNextUpgrade");
const planNextUpgrade = document.querySelector("#planNextUpgrade");
let sessionToken = localStorage.getItem("coc-session-token") || "";
let currentPlayer;
let toastTimer;

apiBase.value = localStorage.getItem("coc-api-base") || "https://coc-companion.getlaunchpod.workers.dev";
playerTag.value = localStorage.getItem("coc-player-tag") || "";

document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));
document.querySelector("#load").addEventListener("click", load);
document.querySelector("#login").addEventListener("click", () => authenticate("/api/auth/login"));
document.querySelector("#register").addEventListener("click", () => authenticate("/api/auth/register"));
logoutButton.addEventListener("click", async () => {
  try { await post("/api/auth/logout", {}, true); } catch (_) { /* expired sessions are already logged out */ }
  sessionToken = "";
  localStorage.removeItem("coc-session-token");
  setAuthStatus("Logged out.");
  updateAuthState();
});
document.querySelector("#baseForm").addEventListener("submit", async event => {
  event.preventDefault();
  try { await post(`/api/base/${encodeURIComponent(playerTag.value.trim())}`, readBase(), true); await load(); }
  catch (error) { showToast(error.message); }
});
document.querySelectorAll("[data-goal]").forEach(button => button.addEventListener("click", async () => {
  if (!currentPlayer) return showToast("Load your account first.");
  if (!sessionToken) return showToast("Log in to change your goal.");
  try {
    await post(`/api/base/${encodeURIComponent(playerTag.value.trim())}`, { ...readBase(), goal: button.dataset.goal }, true);
    document.querySelector("#goal").value = button.dataset.goal;
    await load();
  } catch (error) { showToast(error.message); }
}));
document.querySelector("#askForm").addEventListener("submit", ask);
document.querySelector("#todayAskForm").addEventListener("submit", async event => {
  event.preventDefault();
  document.querySelector("#question").value = document.querySelector("#todayQuestion").value;
  await ask(event, "#todayAnswer");
});

async function load() {
  const base = apiBase.value.replace(/\/$/, "");
  const tag = playerTag.value.trim();
  if (!base || !tag) return showToast("Enter a player tag in Settings.");
  localStorage.setItem("coc-api-base", base);
  localStorage.setItem("coc-player-tag", tag);
  setLoading(true);
  try {
    if (sessionToken) await post(`/api/watch/${encodeURIComponent(tag)}`, {}, true);
    const player = await get(`/api/player/${encodeURIComponent(tag)}`);
    const clanTag = player.clan?.tag;
    const [recs, notifications, accountPlan, savedBase, war, clan, capital] = await Promise.all([
      get(`/api/recommendations/${encodeURIComponent(tag)}`),
      get(`/api/feed/${encodeURIComponent(tag)}`),
      get(`/api/plan/${encodeURIComponent(tag)}`),
      get(`/api/base/${encodeURIComponent(tag)}`),
      clanTag ? get(`/api/war/${encodeURIComponent(clanTag)}`).catch(() => null) : Promise.resolve(null),
      clanTag ? get(`/api/clan/${encodeURIComponent(clanTag)}`).catch(() => null) : Promise.resolve(null),
      clanTag ? get(`/api/capital/${encodeURIComponent(clanTag)}`).catch(() => null) : Promise.resolve(null)
    ]);
    currentPlayer = player;
    if (savedBase) writeBase(savedBase);
    renderIdentity(player, war);
    renderPlayer(player, accountPlan.accountDetails, clan);
    renderPlan(accountPlan);
    renderClanWar(war, clan, capital);
    renderFeed(notifications);
    document.querySelector("#recommendations").innerHTML = recs.length ? recs.map(item => `<li><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.reason)}</small></li>`).join("") : "<li>No configured recommendations.</li>";
    document.querySelector("#goal").value = savedBase?.goal || document.querySelector("#goal").value;
    showToast("Account loaded.");
  } catch (error) {
    showToast(error.message);
  } finally { setLoading(false); }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === name));
}

function renderIdentity(player, war) {
  const trophies = player.trophies === undefined ? "—" : formatNumber(player.trophies);
  const identity = `<div class="identity-card"><span class="th-badge">TH${escapeHtml(player.townHallLevel)}</span><div><strong>${escapeHtml(player.name)}</strong><small>${trophies} trophies</small></div></div>`;
  document.querySelector("#todayIdentity").innerHTML = identity;
  document.querySelector("#headerIdentity").innerHTML = identity;
  const chip = document.querySelector("#todayWarChip");
  chip.textContent = war?.state ? `⚔ ${war.state}${war.endTime ? ` · ${timeUntil(war.endTime)}` : ""}` : "War status unavailable";
  chip.classList.toggle("active", war?.state === "inWar" || war?.state === "preparation");
}

function renderFeed(notifications) {
  const html = notifications.length ? notifications.slice(0, 8).map(item => `<li><strong>${escapeHtml(item.type)}</strong><small>${escapeHtml(item.message)}</small></li>`).join("") : "<li class=\"muted\">No notifications yet.</li>";
  document.querySelector("#todayFeed").innerHTML = html;
}

function renderClanWar(war, clan, capital) {
  warStats.innerHTML = war ? `<p><strong>${escapeHtml(war.state)}</strong>${war.endTime ? ` · ends ${escapeHtml(timeUntil(war.endTime))}` : ""}</p><p>Stars: ${war.sides?.map(side => `${escapeHtml(side.name)} ${escapeHtml(side.stars)}`).join(" · ") || "n/a"}</p><p>Destruction: ${war.sides?.map(side => `${escapeHtml(side.name)} ${escapeHtml(side.destructionPercentage)}%`).join(" · ") || "n/a"}</p><p>Attacks used: ${formatNumber(war.members?.reduce((sum, member) => sum + member.attacksUsed, 0) || 0)} · Unattacked: ${escapeHtml((war.unattacked || []).map(member => member.name).join(", ") || "none")}</p><small>${escapeHtml(war.message || "")}</small>` : "<p>No war data.</p>";
  clanStats.innerHTML = clan ? `<p><strong>${escapeHtml(clan.name)}</strong> · level ${escapeHtml(clan.level || "n/a")}</p><p>War wins: ${formatNumber(clan.warWins || 0)} · Winstreak: ${formatNumber(clan.warWinstreak || 0)}</p><h3>Top donors</h3><ol>${(clan.topDonors || []).map(member => `<li>${escapeHtml(member.name)} · ${formatNumber(member.donations)} (${member.donationRatio === null ? "n/a" : escapeHtml(member.donationRatio.toFixed(2))})</li>`).join("")}</ol><small>${escapeHtml(clan.inactiveSignalNote || "")}</small>` : "<p>No clan data.</p>";
  capitalStats.innerHTML = capital ? `<p><strong>${escapeHtml(capital.state || "unknown")}</strong></p><p>Offensive loot: ${formatNumber(capital.offensiveLoot)} · Defensive loot: ${formatNumber(capital.defensiveLoot)}</p><p>Attacks: ${formatNumber(capital.totalAttacks)} · Raids completed: ${formatNumber(capital.raidsCompleted)} · Districts destroyed: ${formatNumber(capital.districtsDestroyed)}</p><p>Average loot/attack: ${formatNumber(Math.round(capital.averageLootPerAttack))}</p><h3>Top raiders</h3><ol>${(capital.topRaiders || []).map(member => `<li>${escapeHtml(member.name || "Unknown")} · ${formatNumber(member.loot)}</li>`).join("")}</ol>` : "<p>No capital data.</p>";
}

function renderPlan(value) {
  planHeadline.textContent = value.headline;
  planText.textContent = value.planText;
  renderNext(value.actions?.[0], todayNextUpgrade);
  renderNext(value.actions?.[0], planNextUpgrade);
  const completed = value.completedKeys || [];
  completedActions.classList.toggle("hidden", completed.length === 0);
  completedList.innerHTML = completed.map(key => `<p><code>${escapeHtml(key)}</code> <button type="button" data-undone-key="${escapeHtml(key)}">Un-check</button></p>`).join("");
  completedList.querySelectorAll("[data-undone-key]").forEach(button => button.addEventListener("click", async event => {
    try { await post(`/api/done/${encodeURIComponent(playerTag.value.trim())}`, { key: event.currentTarget.dataset.undoneKey }, true, "DELETE"); await load(); }
    catch (error) { showToast(error.message); }
  }));
  actions.innerHTML = (value.actions || []).map(item => `<article class="action"><h3>${escapeHtml(item.action)}</h3><p>${escapeHtml(item.subject)}${item.targetLevel ? ` → level ${escapeHtml(item.targetLevel)}` : ""}</p><p class="resource-line">${resourceCost(item.cost, item.resource)} · ${humanTime(item.timeSeconds)}</p><div><span class="badge">${escapeHtml(item.confidence)}</span><span class="badge">${escapeHtml(item.provenance)}</span>${item.affordable === false ? '<span class="badge warning">unaffordable</span>' : ""}</div><small>${escapeHtml((item.notes || []).join(" "))}</small></article>`).join("");
  completion.innerHTML = `<h3>Account completion</h3><div class="progress"><span style="width:${safePercent(value.completion.overall)}%"></span></div><p>${Math.round(value.completion.overall * 100)}% overall</p>${Object.entries(value.completion.categories || {}).map(([name, percent]) => `<label class="bar-label">${escapeHtml(name)} <span>${Math.round(percent * 100)}%</span><div class="progress"><span style="width:${safePercent(percent)}%"></span></div></label>`).join("")}`;
}

function renderNext(action, target) {
  target.classList.remove("skeleton-block");
  target.innerHTML = action ? `<div class="next-upgrade"><h3>Your next move</h3><p><strong>${escapeHtml(action.action)}</strong></p><p class="resource-line">${resourceCost(action.cost, action.resource)} · ${humanTime(action.timeSeconds)}</p><small>${escapeHtml((action.notes || []).join(" "))}</small><button type="button" data-done-key="${escapeHtml(action.key || "")}" class="gold-button">✓ Mark done</button></div>` : "<div class=\"next-upgrade\"><h3>All caught up</h3><p>No remaining ranked actions.</p></div>";
  target.querySelector("[data-done-key]")?.addEventListener("click", async event => {
    try { await post(`/api/done/${encodeURIComponent(playerTag.value.trim())}`, { key: event.currentTarget.dataset.doneKey }, true); await load(); }
    catch (error) { showToast(error.message); }
  });
}

function renderPlayer(player, details, clan) {
  profileHeader.innerHTML = `<div class="profile-heading"><div><p class="eyebrow">Account details</p><h2>${escapeHtml(player.name)}</h2><p>TH${escapeHtml(player.townHallLevel)} · ${formatNumber(player.trophies)} trophies</p></div><div class="heroes">${(player.heroes || []).map(hero => `<span>${escapeHtml(hero.name)} ${escapeHtml(hero.level)}</span>`).join("")}</div></div>`;
  const categories = details?.categories || {};
  const achievements = player.achievements || [];
  const completedAchievementCount = achievements.filter(item => item.value >= item.target).length;
  const inProgress = achievements.filter(item => item.value < item.target).sort((a, b) => (b.value / b.target) - (a.value / a.target)).slice(0, 6);
  const clanMember = clan?.members?.find(member => member.tag === player.tag);
  const labels = (player.labels || []).map(label => typeof label === "string" ? label : label?.name).filter(Boolean);
  const homeTroops = (player.troops || []).filter(item => item.village !== "builderBase" && !item.superTroopIsActive && !isSuperTroopName(item.name));
  const builderTroops = (player.troops || []).filter(item => item.village === "builderBase" && !item.superTroopIsActive && !isSuperTroopName(item.name));
  accountDetails.innerHTML = `<div class="stats-grid">${stat("Experience", player.expLevel)}${stat("Trophies", player.trophies, player.bestTrophies === undefined ? "" : `best ${formatNumber(player.bestTrophies)}`)}${stat("War stars", player.warStars)}${stat("Attack wins", player.attackWins)}${stat("Defense wins", player.defenseWins)}${stat("Donations", player.donations ?? clanMember?.donations, player.donationsReceived === undefined ? "" : `received ${formatNumber(player.donationsReceived)}`)}${stat("Clan role", player.role || clanMember?.role || "Not exposed")}${stat("War preference", player.warPreference || "Not exposed")}${stat("Builder Hall", player.builderHallLevel, player.builderBaseTrophies === undefined ? "" : `${formatNumber(player.builderBaseTrophies)} trophies`)}${stat("Capital contributions", player.capitalContributions ?? player.clanCapitalContributions)}${stat("League", player.league?.name || "Not exposed")}${stat("Labels", labels.length ? labels.join(", ") : "None")}</div><p class="muted api-note">Builders, current resources, building levels and upgrade timers are not exposed by the official API — enter them under <strong>Your base (manual)</strong>.</p>${renderCategory("Heroes", player.heroes, categories.heroes, "hero")}${renderCategory("Hero equipment", player.heroEquipment || player.heroes?.flatMap(hero => hero.equipment || []), null, "equipment")}${renderCategory("Home troops", homeTroops, categories.troops, "troop")}${renderCategory("Spells", player.spells, categories.spells, "spell")}${renderCategory("Builder-base troops", builderTroops, categories.builderBase, "troop")}<details class="data-details"><summary>Achievements (${formatNumber(achievements.length)} total · ${formatNumber(completedAchievementCount)} completed)</summary>${inProgress.length ? `<ol>${inProgress.map(item => `<li><strong>${escapeHtml(item.name)}</strong><span>${formatNumber(item.value)} / ${formatNumber(item.target)} · ${Math.round(item.value / item.target * 100)}%</span><div class="progress"><span style="width:${safePercent(item.value / item.target)}%"></span></div></li>`).join("")}</ol>` : "<p>No in-progress achievements.</p>"}</details>`;
}

function renderCategory(title, payload, analyzed, kind) {
  if (!payload?.length) return "";
  const byName = new Map((analyzed?.items || []).map(item => [item.name, item]));
  return `<details class="data-details" ${kind === "hero" ? "open" : ""}><summary>${escapeHtml(title)} (${formatNumber(payload.length)})</summary><div class="table-wrap"><table><thead><tr><th>Name</th><th>Level</th><th>${kind === "hero" ? "Target (current Hero Hall cap)" : "Target"}</th><th>Progress</th></tr></thead><tbody>${payload.map(item => { const row = byName.get(item.name); const target = row?.thCapLevel ?? item.maxLevel; const percent = target ? Math.min(1, item.level / target) : 0; return `<tr class="${row && row.remainingLevels > 0 ? "non-maxed" : ""}"><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.level)}</td><td title="${kind === "hero" ? "Cap per current Hero Hall data" : ""}">${target === undefined ? "Not exposed" : `${formatNumber(target)}${item.maxLevel === undefined ? "" : ` / ${formatNumber(item.maxLevel)} max`}`}</td><td><div class="progress"><span style="width:${safePercent(percent)}%"></span></div><small>${Math.round(percent * 100)}%</small></td></tr>`; }).join("")}</tbody></table></div></details>`;
}

function stat(label, value, detail = "") { return `<div class="stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value === undefined || value === null ? "Not exposed" : formatNumber(value))}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`; }
function resourceCost(cost, resource) { if (cost === undefined) return "Manual input required"; const kind = resource === "darkElixir" ? "dark" : resource === "elixir" ? "elixir" : "gold"; return `<span class="resource-dot resource-${kind}"></span>${formatNumber(cost)} ${escapeHtml(resource || "resources")}`; }
function readBase() { const number = id => document.querySelector(`#${id}`).value === "" ? undefined : Number(document.querySelector(`#${id}`).value); return { buildersTotal: number("buildersTotal"), buildersFree: number("buildersFree"), labBusy: document.querySelector("#labBusy").checked, resources: { gold: number("gold"), elixir: number("elixir"), darkElixir: number("darkElixir") }, goal: document.querySelector("#goal").value }; }
function writeBase(base) { for (const id of ["buildersTotal", "buildersFree"]) if (base[id] !== undefined) document.querySelector(`#${id}`).value = base[id]; for (const id of ["gold", "elixir", "darkElixir"]) if (base.resources?.[id] !== undefined) document.querySelector(`#${id}`).value = base.resources[id]; document.querySelector("#labBusy").checked = Boolean(base.labBusy); if (base.goal) document.querySelector("#goal").value = base.goal; document.querySelectorAll("[data-goal]").forEach(button => button.classList.toggle("active", button.dataset.goal === base.goal)); }
async function ask(event, output = "#answer") { event.preventDefault(); const question = output === "#todayAnswer" ? document.querySelector("#todayQuestion").value : document.querySelector("#question").value; try { document.querySelector(output).textContent = (await post("/api/ask", { tag: playerTag.value.trim(), question })).answer; } catch (error) { showToast(error.message); } }
async function get(path) { return parse(await fetch(apiBase.value.replace(/\/$/, "") + path)); }
async function post(path, body, authenticated = false, method = "POST") { const headers = { "Content-Type": "application/json" }; if (authenticated && sessionToken) headers.Authorization = `Bearer ${sessionToken}`; return parse(await fetch(apiBase.value.replace(/\/$/, "") + path, { method, headers, body: JSON.stringify(body) })); }
async function authenticate(path) { try { const result = await post(path, { email: authEmail.value, password: authPassword.value }); if (path.endsWith("register")) return setAuthStatus("Registered. Log in to continue."); sessionToken = result.token; localStorage.setItem("coc-session-token", sessionToken); setAuthStatus("Logged in."); updateAuthState(); await load(); } catch (error) { setAuthStatus(error.message); } }
function updateAuthState() { logoutButton.classList.toggle("hidden", !sessionToken); document.querySelector("#login").classList.toggle("hidden", Boolean(sessionToken)); document.querySelector("#register").classList.toggle("hidden", Boolean(sessionToken)); }
function setAuthStatus(value) { authStatus.textContent = value; }
function setLoading(loading) { document.querySelector("#todayIdentity").classList.toggle("skeleton-block", loading); if (loading) document.querySelector("#todayNextUpgrade").innerHTML = ""; }
function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 4200); }
async function parse(response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Request failed"); return body; }
function humanTime(seconds) { if (!seconds) return "time n/a"; const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); return `${days ? `${days}d ` : ""}${hours}h`; }
function timeUntil(value) { return humanTime(Math.max(0, Math.floor((Date.parse(value) - Date.now()) / 1000))); }
function safePercent(value) { return Math.max(0, Math.min(100, Number(value) * 100 || 0)); }
function formatNumber(value) { return typeof value === "number" ? new Intl.NumberFormat().format(value) : String(value); }
function isSuperTroopName(name) { return name.startsWith("Super ") || ["Sneaky Goblin", "Ice Hound", "Inferno Dragon", "Rocket Balloon"].includes(name); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char])); }
updateAuthState();
if (playerTag.value) load();

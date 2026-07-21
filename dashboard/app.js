const apiBase = document.querySelector("#apiBase");
const playerTag = document.querySelector("#playerTag");
const status = document.querySelector("#status");
const overview = document.querySelector("#overview");
const profileHeader = document.querySelector("#profileHeader");
const accountDetails = document.querySelector("#accountDetails");
const plan = document.querySelector("#plan");
const planHeadline = document.querySelector("#planHeadline");
const planText = document.querySelector("#planText");
const actions = document.querySelector("#actions");
const completion = document.querySelector("#completion");
const clanWar = document.querySelector("#clanWar");
const warStats = document.querySelector("#warStats");
const clanStats = document.querySelector("#clanStats");
const capitalStats = document.querySelector("#capitalStats");
const recommendations = document.querySelector("#recommendations");
const feed = document.querySelector("#feed");
const answer = document.querySelector("#answer");
apiBase.value = localStorage.getItem("coc-api-base") || "https://coc-companion.getlaunchpod.workers.dev";
playerTag.value = localStorage.getItem("coc-player-tag") || "";

document.querySelector("#load").addEventListener("click", load);
document.querySelector("#baseForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await post(`/api/base/${encodeURIComponent(playerTag.value.trim())}`, readBase());
    await load();
  } catch (error) { setStatus(error.message); }
});

async function load() {
  const base = apiBase.value.replace(/\/$/, "");
  const tag = playerTag.value.trim();
  if (!base || !tag) return setStatus("Enter both an API base URL and player tag.");
  localStorage.setItem("coc-api-base", base);
  localStorage.setItem("coc-player-tag", tag);
  setStatus("Loading…");
  try {
    await post(`/api/watch/${encodeURIComponent(tag)}`, {});
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
    if (savedBase) writeBase(savedBase);
    renderPlayer(player, accountPlan.accountDetails, clan);
    renderPlan(accountPlan);
    renderClanWar(war, clan, capital);
    recommendations.innerHTML = recs.length ? recs.map(item => `<li><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.reason)}</small></li>`).join("") : "<li>No configured recommendations.</li>";
    feed.innerHTML = notifications.length ? notifications.map(item => `<li><strong>${escapeHtml(item.type)}</strong><small>${escapeHtml(item.message)}</small></li>`).join("") : "<li>No notifications yet.</li>";
    setStatus("Loaded.");
  } catch (error) { setStatus(error.message); }
}

function renderClanWar(war, clan, capital) {
  if (!war && !clan && !capital) return;
  clanWar.classList.remove("hidden");
  warStats.innerHTML = war ? `<p><strong>${escapeHtml(war.state)}</strong>${war.endTime ? ` · ends ${escapeHtml(timeUntil(war.endTime))}` : ""}</p><p>Stars: ${war.sides?.map(side => `${escapeHtml(side.name)} ${escapeHtml(side.stars)}`).join(" · ") || "n/a"}</p><p>Destruction: ${war.sides?.map(side => `${escapeHtml(side.name)} ${escapeHtml(side.destructionPercentage)}%`).join(" · ") || "n/a"}</p><p>Attacks used: ${escapeHtml(war.members?.reduce((sum, member) => sum + member.attacksUsed, 0) || 0)} · Unattacked: ${escapeHtml((war.unattacked || []).map(member => member.name).join(", ") || "none")}</p><small>${escapeHtml(war.message || "")}</small>` : "<p>No war data.</p>";
  clanStats.innerHTML = clan ? `<p><strong>${escapeHtml(clan.name)}</strong> · level ${escapeHtml(clan.level || "n/a")}</p><p>War wins: ${escapeHtml(clan.warWins || 0)} · Winstreak: ${escapeHtml(clan.warWinstreak || 0)}</p><h3>Top donors</h3><ol>${(clan.topDonors || []).map(member => `<li>${escapeHtml(member.name)} · ${escapeHtml(member.donations)} (${member.donationRatio === null ? "n/a" : escapeHtml(member.donationRatio.toFixed(2))})</li>`).join("")}</ol><small>${escapeHtml(clan.inactiveSignalNote || "")}</small>` : "<p>No clan data.</p>";
  capitalStats.innerHTML = capital ? `<p><strong>${escapeHtml(capital.state || "unknown")}</strong></p><p>Offensive loot: ${escapeHtml(capital.offensiveLoot)} · Defensive loot: ${escapeHtml(capital.defensiveLoot)}</p><p>Attacks: ${escapeHtml(capital.totalAttacks)} · Raids completed: ${escapeHtml(capital.raidsCompleted)} · Districts destroyed: ${escapeHtml(capital.districtsDestroyed)}</p><p>Average loot/attack: ${escapeHtml(Math.round(capital.averageLootPerAttack))}</p><h3>Top raiders</h3><ol>${(capital.topRaiders || []).map(member => `<li>${escapeHtml(member.name || "Unknown")} · ${escapeHtml(member.loot)}</li>`).join("")}</ol>` : "<p>No capital data.</p>";
}

function renderPlayer(player, details, clan) {
  overview.classList.remove("hidden");
  profileHeader.innerHTML = `<div class="profile-heading"><div><p class="eyebrow">Account details</p><h2>${escapeHtml(player.name)}</h2><p>TH${escapeHtml(player.townHallLevel)} · ${formatNumber(player.trophies)} trophies</p></div><div class="heroes">${(player.heroes || []).map(hero => `<span>${escapeHtml(hero.name)} ${escapeHtml(hero.level)}</span>`).join("")}</div></div>`;
  const categories = details?.categories || {};
  const achievements = player.achievements || [];
  const completedAchievements = achievements.filter(item => item.value >= item.target).length;
  const inProgress = achievements.filter(item => item.value < item.target).sort((a, b) => (b.value / b.target) - (a.value / a.target)).slice(0, 6);
  const clanMember = clan?.members?.find(member => member.tag === player.tag);
  const role = player.role || clanMember?.role;
  const donations = player.donations ?? clanMember?.donations;
  const received = player.donationsReceived ?? clanMember?.donationsReceived;
  const labels = (player.labels || []).map(label => typeof label === "string" ? label : label?.name).filter(Boolean);
  accountDetails.innerHTML = `<div class="stats-grid">${stat("Experience", player.expLevel)}${stat("Trophies", player.trophies, player.bestTrophies === undefined ? "" : `best ${formatNumber(player.bestTrophies)}`)}${stat("War stars", player.warStars)}${stat("Attack wins", player.attackWins)}${stat("Defense wins", player.defenseWins)}${stat("Donations", donations, received === undefined ? "" : `received ${formatNumber(received)}`)}${stat("Clan role", role || "Not exposed")}${stat("War preference", player.warPreference || "Not exposed")}${stat("Builder Hall", player.builderHallLevel, player.builderBaseTrophies === undefined ? "" : `${formatNumber(player.builderBaseTrophies)} trophies`)}${stat("Capital contributions", player.capitalContributions ?? player.clanCapitalContributions)}${stat("League", player.league?.name || "Not exposed")}${stat("Labels", labels.length ? labels.join(", ") : "None")}</div><p class="muted api-note">Builders, current resources, building levels and upgrade timers are not exposed by the official API — enter them under <strong>Your base (manual)</strong>.</p>${renderCategory("Heroes", player.heroes, categories.heroes, "hero")}${renderCategory("Hero equipment", player.heroEquipment || player.heroes?.flatMap(hero => hero.equipment || []), null, "equipment")}${renderCategory("Home troops", (player.troops || []).filter(item => item.village !== "builderBase"), categories.troops, "troop")}${renderCategory("Spells", player.spells, categories.spells, "spell")}${renderCategory("Builder-base troops", (player.troops || []).filter(item => item.village === "builderBase"), categories.builderBase, "troop")}${renderCategory("Pets", player.pets, null, "pet")}<details class="data-details"><summary>Achievements (${formatNumber(achievements.length)} total · ${formatNumber(completedAchievements)} completed)</summary>${inProgress.length ? `<ol class="achievement-list">${inProgress.map(item => `<li><strong>${escapeHtml(item.name)}</strong><span>${formatNumber(item.value)} / ${formatNumber(item.target)} · ${Math.round(item.value / item.target * 100)}%</span><div class="progress"><span style="width:${safePercent(item.value / item.target)}%"></span></div></li>`).join("")}</ol>` : "<p>No in-progress achievements.</p>"}</details>`;
}

function stat(label, value, detail = "") {
  return `<div class="stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value === undefined || value === null ? "Not exposed" : formatNumber(value))}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`;
}

function renderCategory(title, payload, analyzed, kind) {
  if (!payload?.length) return "";
  const byName = new Map((analyzed?.items || []).map(item => [item.name, item]));
  return `<details class="data-details" ${kind === "hero" ? "open" : ""}><summary>${escapeHtml(title)} (${formatNumber(payload.length)})</summary><div class="table-wrap"><table><thead><tr><th>Name</th><th>Level</th><th>Target</th><th>Progress</th></tr></thead><tbody>${payload.map(item => {
    const row = byName.get(item.name);
    const target = row?.thCapLevel ?? item.maxLevel;
    const max = item.maxLevel;
    const percent = target ? Math.min(1, item.level / target) : 0;
    return `<tr class="${row && row.remainingLevels > 0 ? "non-maxed" : ""}"><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.level)}</td><td>${target === undefined ? "Not exposed" : `${formatNumber(target)}${max !== undefined ? ` / ${formatNumber(max)} max` : ""}`}</td><td><div class="progress"><span style="width:${safePercent(percent)}%"></span></div><small>${Math.round(percent * 100)}%</small></td></tr>`;
  }).join("")}</tbody></table></div></details>`;
}

function renderPlan(value) {
  plan.classList.remove("hidden");
  planHeadline.textContent = value.headline;
  planText.textContent = value.planText;
  actions.innerHTML = (value.actions || []).map(item => `<article class="action"><h3>${escapeHtml(item.action)}</h3><p>${escapeHtml(item.subject)}${item.targetLevel ? ` → level ${escapeHtml(item.targetLevel)}` : ""}</p><p>${item.cost !== undefined ? `${escapeHtml(item.cost)} ${escapeHtml(item.resource || "resources")}` : "Manual input required"} · ${humanTime(item.timeSeconds)}</p><div><span class="badge">${escapeHtml(item.confidence)}</span><span class="badge">${escapeHtml(item.provenance)}</span>${item.affordable === false ? '<span class="badge warning">unaffordable</span>' : ""}</div><small>${escapeHtml((item.notes || []).join(" "))}</small></article>`).join("");
  completion.innerHTML = `<h3>Account completion</h3><div class="progress"><span style="width:${safePercent(value.completion.overall)}%"></span></div><p>${Math.round(value.completion.overall * 100)}% overall</p>${Object.entries(value.completion.categories || {}).map(([name, percent]) => `<label class="bar-label">${escapeHtml(name)} <span>${Math.round(percent * 100)}%</span><div class="progress"><span style="width:${safePercent(percent)}%"></span></div></label>`).join("")}`;
}

function readBase() {
  const number = id => document.querySelector(`#${id}`).value === "" ? undefined : Number(document.querySelector(`#${id}`).value);
  return { buildersTotal: number("buildersTotal"), buildersFree: number("buildersFree"), labBusy: document.querySelector("#labBusy").checked, resources: { gold: number("gold"), elixir: number("elixir"), darkElixir: number("darkElixir") }, goal: document.querySelector("#goal").value };
}
function writeBase(base) {
  for (const id of ["buildersTotal", "buildersFree"]) if (base[id] !== undefined) document.querySelector(`#${id}`).value = base[id];
  for (const id of ["gold", "elixir", "darkElixir"]) if (base.resources?.[id] !== undefined) document.querySelector(`#${id}`).value = base.resources[id];
  document.querySelector("#labBusy").checked = Boolean(base.labBusy);
  if (base.goal) document.querySelector("#goal").value = base.goal;
}
document.querySelector("#askForm").addEventListener("submit", async event => {
  event.preventDefault();
  try { answer.textContent = (await post("/api/ask", { tag: playerTag.value.trim(), question: document.querySelector("#question").value })).answer; }
  catch (error) { answer.textContent = error.message; }
});
async function get(path) { return parse(await fetch(apiBase.value.replace(/\/$/, "") + path)); }
async function post(path, body) { return parse(await fetch(apiBase.value.replace(/\/$/, "") + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); }
async function parse(response) { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Request failed"); return body; }
function setStatus(value) { status.textContent = value; }
function humanTime(seconds) { if (!seconds) return "time n/a"; const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); return `${days ? `${days}d ` : ""}${hours}h`; }
function timeUntil(value) { const seconds = Math.max(0, Math.floor((Date.parse(value) - Date.now()) / 1000)); return humanTime(seconds); }
function safePercent(value) { return Math.max(0, Math.min(100, Number(value) * 100 || 0)); }
function formatNumber(value) { return typeof value === "number" ? new Intl.NumberFormat().format(value) : String(value); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char])); }

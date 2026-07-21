const apiBase = document.querySelector("#apiBase");
const playerTag = document.querySelector("#playerTag");
const status = document.querySelector("#status");
const overview = document.querySelector("#overview");
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
    renderPlayer(player);
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

function renderPlayer(player) {
  overview.classList.remove("hidden");
  overview.innerHTML = `<h2>${escapeHtml(player.name)}</h2><p>TH${escapeHtml(player.townHallLevel)} · ${escapeHtml(player.trophies || 0)} trophies</p><div class="heroes">${(player.heroes || []).map(hero => `<span>${escapeHtml(hero.name)} ${escapeHtml(hero.level)}</span>`).join("")}</div>`;
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
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char])); }

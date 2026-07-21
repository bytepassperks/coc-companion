const apiBase = document.querySelector("#apiBase");
const playerTag = document.querySelector("#playerTag");
const toast = document.querySelector("#toast");
const profileHeader = document.querySelector("#profileHeader");
const accountDetails = document.querySelector("#accountDetails");
const planHeadline = document.querySelector("#planHeadline");
const planText = document.querySelector("#planText");
const aiReview = document.querySelector("#aiReview");
const actions = document.querySelector("#actions");
const completion = document.querySelector("#completion");
const warStats = document.querySelector("#warStats");
const clanStats = document.querySelector("#clanStats");
const capitalStats = document.querySelector("#capitalStats");
const warPrediction = document.querySelector("#warPrediction");
const todayBenchmark = document.querySelector("#todayBenchmark");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authStatus = document.querySelector("#authStatus");
const logoutButton = document.querySelector("#logout");
const completedActions = document.querySelector("#completedActions");
const completedList = document.querySelector("#completedList");
const skippedActions = document.querySelector("#skippedActions");
const skippedList = document.querySelector("#skippedList");
const todayNextUpgrade = document.querySelector("#todayNextUpgrade");
const planNextUpgrade = document.querySelector("#planNextUpgrade");
const planEquipment = document.querySelector("#planEquipment");
const todayTimers = document.querySelector("#todayTimers");
const todayRush = document.querySelector("#todayRush");
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
document.querySelector("#timerForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await post(`/api/timers/${encodeURIComponent(playerTag.value.trim())}`, {
      kind: document.querySelector("#timerKind").value,
      label: document.querySelector("#timerLabel").value,
      durationSeconds: parseDuration(document.querySelector("#timerDuration").value)
    }, true);
    event.target.reset();
    await load();
  } catch (error) { showToast(error.message); }
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
    const [recs, notifications, accountPlan, savedBase, war, clan, capital, prediction, benchmark, timers, rush] = await Promise.all([
      get(`/api/recommendations/${encodeURIComponent(tag)}`),
      get(`/api/feed/${encodeURIComponent(tag)}`),
      get(`/api/plan/${encodeURIComponent(tag)}`),
      get(`/api/base/${encodeURIComponent(tag)}`),
      clanTag ? get(`/api/war/${encodeURIComponent(clanTag)}`).catch(() => null) : Promise.resolve(null),
      clanTag ? get(`/api/clan/${encodeURIComponent(clanTag)}`).catch(() => null) : Promise.resolve(null),
      clanTag ? get(`/api/capital/${encodeURIComponent(clanTag)}`).catch(() => null) : Promise.resolve(null),
      get(`/api/predict/war/${encodeURIComponent(tag)}`).catch(() => null),
      get(`/api/benchmark/${encodeURIComponent(tag)}`).catch(() => null),
      get(`/api/timers/${encodeURIComponent(tag)}`).catch(() => []),
      get(`/api/rush/${encodeURIComponent(tag)}`).catch(() => null)
    ]);
    currentPlayer = player;
    if (savedBase) writeBase(savedBase);
    renderIdentity(player, war);
    renderPlayer(player, accountPlan.accountDetails, clan, accountPlan.rushScore);
    renderHeroLineup(player, savedBase?.heroLineup || []);
    renderHeroLoadouts(player, savedBase?.heroLoadouts || {});
    renderArmySelectors(player, savedBase || {});
    renderPlan(accountPlan);
    renderClanWar(war, clan, capital, prediction);
    renderBenchmark(benchmark);
    renderTimers(timers);
    renderRush(rush);
    renderFeed(notifications);
    document.querySelector("#recommendations").innerHTML = recs.length ? recs.map(item => `<li><strong>${escapeHtml(humanizeSubject(item.subject))}${humanizeSubject(item.subject).toLowerCase() === humanizeCategory(item.category).toLowerCase() ? "" : ` <span class="recommendation-category">— ${escapeHtml(humanizeCategory(item.category))}</span>`}</strong><small>${escapeHtml(item.reason)}</small></li>`).join("") : "<li>No configured recommendations.</li>";
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
  const identity = `<div class="identity-card"><span class="th-badge">TH${escapeHtml(player.townHallLevel)}</span><div><strong>${escapeHtml(player.name)}</strong><small>${trophies} trophies</small>${heroEquipmentLine(player)}</div></div>`;
  document.querySelector("#todayIdentity").innerHTML = identity;
  document.querySelector("#headerIdentity").innerHTML = identity;
  const chip = document.querySelector("#todayWarChip");
  chip.textContent = war?.state ? `⚔ ${humanizeSlug(war.state)}${war.endTime ? ` · ${timeUntil(war.endTime)}` : ""}` : "War status unavailable";
  chip.classList.toggle("active", war?.state === "inWar" || war?.state === "preparation");
}

function renderFeed(notifications) {
  const html = notifications.length ? notifications.slice(0, 8).map(item => `<li><strong>${escapeHtml(humanizeSlug(item.type))}</strong><small>${escapeHtml(item.message)}</small></li>`).join("") : "<li class=\"muted\">No notifications yet.</li>";
  document.querySelector("#todayFeed").innerHTML = html;
}

function renderClanWar(war, clan, capital, prediction) {
  warStats.innerHTML = war ? `<p><strong>${escapeHtml(humanizeSlug(war.state))}</strong>${war.endTime ? ` · ends ${escapeHtml(timeUntil(war.endTime))}` : ""}</p><p>Stars: ${war.sides?.map(side => `${escapeHtml(side.name)} ${escapeHtml(side.stars)}`).join(" · ") || "n/a"}</p><p>Destruction: ${war.sides?.map(side => `${escapeHtml(side.name)} ${escapeHtml(side.destructionPercentage)}%`).join(" · ") || "n/a"}</p><p>Attacks used: ${formatNumber(war.members?.reduce((sum, member) => sum + member.attacksUsed, 0) || 0)} · Unattacked: ${escapeHtml((war.unattacked || []).map(member => member.name).join(", ") || "none")}</p><small>${escapeHtml(war.message || "")}</small>` : "<p>No war data.</p>";
  clanStats.innerHTML = clan ? `<p><strong>${escapeHtml(clan.name)}</strong> · level ${escapeHtml(clan.level || "n/a")}</p><p>War wins: ${formatNumber(clan.warWins || 0)} · Winstreak: ${formatNumber(clan.warWinstreak || 0)}</p><h3>Top donors</h3><ol>${(clan.topDonors || []).map(member => `<li>${escapeHtml(member.name)} · ${formatNumber(member.donations)} (${member.donationRatio === null ? "n/a" : escapeHtml(member.donationRatio.toFixed(2))})</li>`).join("")}</ol><small>${escapeHtml(clan.inactiveSignalNote || "")}</small>` : "<p>No clan data.</p>";
  capitalStats.innerHTML = capital ? `<p><strong>${escapeHtml(capital.state || "unknown")}</strong></p><p>Offensive loot: ${formatNumber(capital.offensiveLoot)} · Defensive loot: ${formatNumber(capital.defensiveLoot)}</p><p>Attacks: ${formatNumber(capital.totalAttacks)} · Raids completed: ${formatNumber(capital.raidsCompleted)} · Districts destroyed: ${formatNumber(capital.districtsDestroyed)}</p><p>Average loot/attack: ${formatNumber(Math.round(capital.averageLootPerAttack))}</p><h3>Top raiders</h3><ol>${(capital.topRaiders || []).map(member => `<li>${escapeHtml(member.name || "Unknown")} · ${formatNumber(member.loot)}</li>`).join("")}</ol>` : "<p>No capital data.</p>";
  warPrediction.innerHTML = prediction?.predictions?.length ? `<p class="advisory-label">Advisory prediction — ${escapeHtml(prediction.modelMeta?.mode || "heuristic")} v${escapeHtml(prediction.modelMeta?.version || "heuristic")}</p><ul>${prediction.predictions.map(item => `<li>${escapeHtml(item.attackerTag)} vs position ${escapeHtml(item.mapPosition || "n/a")}: predicted ${escapeHtml(item.predictedStars)} stars vs target ${escapeHtml(item.starsTarget)} (${Math.round(item.probability * 100)}% chance of 2+)</li>`).join("")}</ul><small>Source: self-collected public war snapshots. No replays, armies, or base layouts are available.</small>` : `<p>${escapeHtml(prediction?.message || "No current-war prediction is available yet.")}</p><small>Predictions are advisory only and never automate attacks.</small>`;
}

function renderBenchmark(value) {
  todayBenchmark.innerHTML = value?.state === "ready"
    ? `<span class="advisory-label">Benchmark: ${escapeHtml(value.percentiles?.trophies)}th percentile trophies</span><small>Compared with ${formatNumber(value.sampleSize)} collected public snapshots.</small>`
    : value?.message ? `<small>${escapeHtml(value.message)}</small>` : "";
}

function renderPlan(value) {
  planHeadline.textContent = value.headline;
  planText.textContent = value.planText;
  const review = value.aiReview;
  aiReview.innerHTML = review
    ? `<strong>Expert panel: ${review.verdict === "endorsed" ? "✔ endorsed by AI strategist panel" : "⚖ adjusted by AI strategist panel"}</strong>${review.notes?.length ? `<ul>${review.notes.map(note => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}`
    : "";
  const catalogMeta = value.catalogMeta;
  const gameData = catalogMeta ? `Game data: ${formatDate(catalogMeta.fetchedAt)} (auto-updated daily)` : "Game data date unavailable";
  document.querySelector("#gameDataMeta").textContent = gameData;
  document.querySelector("#footerGameData").textContent = gameData;
  const equipmentAdvice = value.equipmentAdvice?.equipment || [];
  const petAdvice = value.equipmentAdvice?.pets || [];
  planEquipment.innerHTML = currentPlayer ? `<h3>Active timers</h3><p class="muted">${(value.timers || []).length ? value.timers.map(timer => `${escapeHtml(timer.label)} · ${escapeHtml(timeUntil(timer.endsAt))}`).join(" · ") : "No active timers."}</p><p class="equipment-context"><strong>Hero equipment:</strong> ${heroEquipmentLine(currentPlayer).replace(/^<span class="equipment-compact">|<\/span>$/g, "") || "No equipment data in the API payload."}</p>${equipmentAdvice.map(item => `<article class="equipment-advice"><strong>${escapeHtml(item.hero)}: ${escapeHtml(item.recommended.join(" + "))}</strong>${item.lineupStatus === "not_in_lineup" ? "<span class=\"badge\">Not in lineup</span>" : ""}<p>${escapeHtml(item.priority)}</p><small>${escapeHtml(item.provenance)}</small></article>`).join("")}${value.equipmentAdvice?.unknownEquipment?.length ? `<p class="muted">Metadata unavailable for: ${value.equipmentAdvice.unknownEquipment.map(escapeHtml).join(", ")}</p>` : ""}${petAdvice.length ? `<h3>Pet pairings</h3>${petAdvice.map(item => `<article class="equipment-advice"><strong>${escapeHtml(item.name)} ${formatNumber(item.level)}/${formatNumber(item.maxLevel)}</strong><p>${escapeHtml(item.priority)}</p><small>${escapeHtml(item.provenance)}</small></article>`).join("")}` : "<p class=\"muted\">No pet data is exposed for this account.</p>"}` : "";
  renderNext(value.actions?.[0], todayNextUpgrade);
  renderNext(value.actions?.[0], planNextUpgrade);
  const completed = value.completedKeys || [];
  completedActions.classList.toggle("hidden", completed.length === 0);
  completedList.innerHTML = completed.map(key => `<p><code>${escapeHtml(humanizeActionKey(key))}</code> <button type="button" data-undone-key="${escapeHtml(key)}">Un-check</button></p>`).join("");
  completedList.querySelectorAll("[data-undone-key]").forEach(button => button.addEventListener("click", async event => {
    try { await post(`/api/done/${encodeURIComponent(playerTag.value.trim())}`, { key: event.currentTarget.dataset.undoneKey }, true, "DELETE"); await load(); }
    catch (error) { showToast(error.message); }
  }));
  const skipped = value.skippedKeys || [];
  skippedActions.classList.toggle("hidden", skipped.length === 0);
  skippedList.innerHTML = skipped.map(key => `<p><code>${escapeHtml(humanizeActionKey(key))}</code> <button type="button" data-unskip-key="${escapeHtml(key)}">Un-skip</button></p>`).join("");
  skippedList.querySelectorAll("[data-unskip-key]").forEach(button => button.addEventListener("click", async event => {
    try { await post(`/api/skip/${encodeURIComponent(playerTag.value.trim())}`, { key: event.currentTarget.dataset.unskipKey }, true, "DELETE"); await load(); }
    catch (error) { showToast(error.message); }
  }));
  actions.innerHTML = (value.actions || []).map(item => `<article class="action"><h3>${escapeHtml(humanizeSlug(item.action))}</h3><p>${escapeHtml(humanizeSubject(item.subject))}${item.targetLevel ? ` → level ${escapeHtml(item.targetLevel)}` : ""}</p><p class="resource-line">${resourceCost(item.cost, item.resource)} · ${humanTime(item.timeSeconds)}</p><div><span class="badge">${escapeHtml(humanizeSlug(item.confidence))}</span><span class="badge">${escapeHtml(humanizeSlug(item.provenance))}</span>${item.affordable === false ? '<span class="badge warning">Unaffordable</span>' : ""}</div><small>${escapeHtml((item.notes || []).join(" "))}</small></article>`).join("");
  completion.innerHTML = `<h3>Account completion</h3><div class="progress"><span style="width:${safePercent(value.completion.overall)}%"></span></div><p>${Math.round(value.completion.overall * 100)}% overall</p>${Object.entries(value.completion.categories || {}).map(([name, percent]) => `<label class="bar-label">${escapeHtml(humanizeCategory(name))} <span>${Math.round(percent * 100)}%</span><div class="progress"><span style="width:${safePercent(percent)}%"></span></div></label>`).join("")}`;
}

function renderTimers(timers) {
  todayTimers.innerHTML = timers?.length ? `<ul>${timers.map(timer => `<li><strong>${escapeHtml(timer.label)}</strong> · ${escapeHtml(timer.kind)} · <span>${escapeHtml(timeUntil(timer.endsAt))}</span> <button type="button" class="secondary timer-delete" data-timer-id="${escapeHtml(timer.id)}">Delete</button></li>`).join("")}</ul>` : "<p class=\"muted\">No active timers. Add one to receive a completion alert.</p>";
  todayTimers.querySelectorAll("[data-timer-id]").forEach(button => button.addEventListener("click", async event => {
    try { await post(`/api/timers/${encodeURIComponent(playerTag.value.trim())}`, { id: event.currentTarget.dataset.timerId }, true, "DELETE"); await load(); } catch (error) { showToast(error.message); }
  }));
}

function renderRush(value) {
  todayRush.innerHTML = value ? `<p><strong>${escapeHtml(humanizeSlug(value.verdict))}</strong> · ${formatNumber(value.score)}/100 readiness</p>${value.categories.map(item => `<label class="bar-label">${escapeHtml(item.name)} <span>${Math.round(item.completion * 100)}%</span><div class="progress"><span style="width:${safePercent(item.completion)}%"></span></div></label>`).join("")}<small>${escapeHtml(value.unavailableNote)}</small>` : "<p class=\"muted\">Readiness unavailable.</p>";
}

function renderNext(action, target) {
  target.classList.remove("skeleton-block");
  target.innerHTML = action ? `<div class="next-upgrade"><h3>Your next move</h3><p><strong>${escapeHtml(humanizeSlug(action.action))}</strong></p><p class="resource-line">${resourceCost(action.cost, action.resource)} · ${humanTime(action.timeSeconds)}</p><small>${escapeHtml((action.notes || []).join(" "))}</small><div class="next-move-buttons"><button type="button" data-done-key="${escapeHtml(action.key || "")}" class="gold-button">✓ Mark done</button><button type="button" data-skip-key="${escapeHtml(action.key || "")}" class="secondary">↩ Skip for now</button></div></div>` : "<div class=\"next-upgrade\"><h3>All caught up</h3><p>No remaining ranked actions.</p></div>";
  target.querySelector("[data-done-key]")?.addEventListener("click", async event => {
    try { await post(`/api/done/${encodeURIComponent(playerTag.value.trim())}`, { key: event.currentTarget.dataset.doneKey }, true); await load(); }
    catch (error) { showToast(error.message); }
  });
  target.querySelector("[data-skip-key]")?.addEventListener("click", async event => {
    try { await post(`/api/skip/${encodeURIComponent(playerTag.value.trim())}`, { key: event.currentTarget.dataset.skipKey }, true); await load(); }
    catch (error) { showToast(error.message); }
  });
}

function humanizeCategory(value) {
  const labels = { heroes_equipment: "Heroes & equipment", offense_buildings: "Offense buildings", th_weapon: "Town Hall weapon", key_defenses: "Key defenses", remaining_defenses: "Remaining defenses", army_camps: "Army Camps", walls: "Walls", laboratory: "Lab research", clan_castle: "Clan Castle" };
  return labels[value] || humanizeSlug(value);
}
function humanizeSubject(value) { return humanizeSlug(value); }
function humanizeSlug(value) { return String(value).replaceAll("_", " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, character => character.toUpperCase()); }
function humanizeActionKey(value) { const parts = String(value).split(":"); return `${humanizeSlug(parts[0])}: ${humanizeSubject(parts[1] || "")}${parts[2] && parts[2] !== "unlock" ? ` → level ${parts[2]}` : ""}`; }

function renderHeroLineup(player, selected = []) {
  const target = document.querySelector("#heroLineup");
  if (!target) return;
  target.innerHTML = `<legend>Hero lineup (up to 4)</legend>${(player.heroes || []).map(hero => `<label class="chip"><input type="checkbox" value="${escapeHtml(hero.name)}" ${selected.includes(hero.name) ? "checked" : ""}>${escapeHtml(hero.name)}</label>`).join("")}`;
  target.querySelectorAll("input").forEach(input => input.addEventListener("change", () => {
    if (target.querySelectorAll("input:checked").length > 4) input.checked = false;
  }));
}
function renderArmySelectors(player, base) {
  const units = [...(player.troops || []).filter(item => item.village !== "builderBase"), ...(player.spells || [])].map(item => item.name);
  const render = (id, selected) => {
    const target = document.querySelector(`#${id}`);
    target.innerHTML = `<strong>${id === "warArmy" ? "War army" : "Home army"}</strong><div class="chip-list">${units.map(name => `<label class="chip"><input type="checkbox" value="${escapeHtml(name)}" ${selected.includes(name) ? "checked" : ""}>${escapeHtml(name)}</label>`).join("")}</div>`;
    target.querySelectorAll("input").forEach(input => input.addEventListener("change", () => { if (target.querySelectorAll("input:checked").length > 12) input.checked = false; }));
  };
  render("warArmy", base.warArmy || []);
  render("homeArmy", base.homeArmy || []);
  const same = document.querySelector("#sameArmy");
  same.checked = Boolean(base.sameArmy);
  const toggle = () => document.querySelector("#homeArmy").classList.toggle("hidden", same.checked);
  same.addEventListener("change", toggle);
  toggle();
}
function renderHeroLoadouts(player, saved) {
  const target = document.querySelector("#heroLoadouts");
  if (!target) return;
  const equipment = player.heroEquipment?.length ? player.heroEquipment : (player.heroes || []).flatMap(hero => hero.equipment || []);
  const pets = player.pets?.length ? player.pets : (player.troops || []).filter(item => item.village !== "builderBase" && ["L.A.S.S.I", "Electro Owl", "Mighty Yak", "Unicorn", "Frosty", "Diggy", "Poison Lizard", "Phoenix", "Spirit Fox", "Angry Jelly", "Sneezy"].includes(item.name));
  target.innerHTML = `<legend>My hero loadouts</legend>${(player.heroes || []).map(hero => { const selected = saved[hero.name] || {}; const ownEquipment = equipment.filter(item => hero.equipment?.some(entry => entry.name === item.name) || !hero.equipment).map(item => item.name); return `<div class="loadout-row"><strong>${escapeHtml(hero.name)}</strong><label>Equipment 1<select data-loadout-hero="${escapeHtml(hero.name)}" data-loadout-slot="equipment"><option value="">None</option>${ownEquipment.map(name => `<option ${selected.equipment?.[0] === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label><label>Equipment 2<select data-loadout-hero="${escapeHtml(hero.name)}" data-loadout-slot="equipment"><option value="">None</option>${ownEquipment.map(name => `<option ${selected.equipment?.[1] === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label><label>Pet<select data-loadout-hero="${escapeHtml(hero.name)}" data-loadout-slot="pet"><option value="">None</option>${pets.map(pet => `<option ${selected.pet === pet.name ? "selected" : ""}>${escapeHtml(pet.name)}</option>`).join("")}</select></label></div>`; }).join("")}`;
}
function renderPlayer(player, details, clan, rush) {
  profileHeader.innerHTML = `<div class="profile-heading"><div><p class="eyebrow">Account details</p><h2>${escapeHtml(player.name)}</h2><p>TH${escapeHtml(player.townHallLevel)} · ${formatNumber(player.trophies)} trophies</p></div><div class="heroes">${(player.heroes || []).map(hero => `<span>${escapeHtml(hero.name)} ${escapeHtml(hero.level)}</span>`).join("")}</div></div>`;
  const categories = details?.categories || {};
  const achievements = player.achievements || [];
  const completedAchievementCount = achievements.filter(item => item.value >= item.target).length;
  const inProgress = achievements.filter(item => item.value < item.target).sort((a, b) => (b.value / b.target) - (a.value / a.target)).slice(0, 6);
  const clanMember = clan?.members?.find(member => member.tag === player.tag);
  const labels = (player.labels || []).map(label => typeof label === "string" ? label : label?.name).filter(Boolean);
  const equipment = player.heroEquipment?.length ? player.heroEquipment : player.heroes?.flatMap(hero => hero.equipment || []) || [];
  const homeTroops = (player.troops || []).filter(item => item.village !== "builderBase" && !item.superTroopIsActive && !isSuperTroopName(item.name));
  const builderTroops = (player.troops || []).filter(item => item.village === "builderBase" && !item.superTroopIsActive && !isSuperTroopName(item.name));
  accountDetails.innerHTML = `<div class="stats-grid">${stat("Experience", player.expLevel)}${stat("Trophies", player.trophies, player.bestTrophies === undefined ? "" : `best ${formatNumber(player.bestTrophies)}`)}${stat("War stars", player.warStars)}${stat("Attack wins", player.attackWins)}${stat("Defense wins", player.defenseWins)}${stat("Donations", player.donations ?? clanMember?.donations, player.donationsReceived === undefined ? "" : `received ${formatNumber(player.donationsReceived)}`)}${stat("Clan role", player.role || clanMember?.role || "Not exposed")}${stat("War preference", player.warPreference || "Not exposed")}${stat("Builder Hall", player.builderHallLevel, player.builderBaseTrophies === undefined ? "" : `${formatNumber(player.builderBaseTrophies)} trophies`)}${stat("Capital contributions", player.capitalContributions ?? player.clanCapitalContributions)}${stat("League", player.league?.name || "Not exposed")}${stat("Labels", labels.length ? labels.join(", ") : "None")}</div><p class="muted api-note">Builders, current resources, building levels and upgrade timers are not exposed by the official API — enter them under <strong>Your base (manual)</strong>.</p>${rush ? `<section class="rush-details"><h3>Advance Town Hall? ${escapeHtml(rush.score)}/100 · ${escapeHtml(humanizeSlug(rush.verdict))}</h3>${rush.categories.map(item => `<label class="bar-label">${escapeHtml(item.name)} <span>${Math.round(item.completion * 100)}%</span><div class="progress"><span style="width:${safePercent(item.completion)}%"></span></div></label>`).join("")}<small>${escapeHtml(rush.unavailableNote)}</small></section>` : ""}${renderCategory("Heroes", player.heroes, categories.heroes, "hero")}${renderCategory("Hero equipment", equipment, null, "equipment")}${renderCategory("Home troops", homeTroops, categories.troops, "troop")}${renderCategory("Spells", player.spells, categories.spells, "spell")}${renderCategory("Builder-base troops", builderTroops, categories.builderBase, "troop")}<details class="data-details"><summary>Achievements (${formatNumber(achievements.length)} total · ${formatNumber(completedAchievementCount)} completed)</summary>${inProgress.length ? `<ol>${inProgress.map(item => `<li><strong>${escapeHtml(item.name)}</strong><span>${formatNumber(item.value)} / ${formatNumber(item.target)} · ${Math.round(item.value / item.target * 100)}%</span><div class="progress"><span style="width:${safePercent(item.value / item.target)}%"></span></div></li>`).join("")}</ol>` : "<p>No in-progress achievements.</p>"}</details>`;
}

function renderCategory(title, payload, analyzed, kind) {
  if (!payload?.length) return "";
  const byName = new Map((analyzed?.items || []).map(item => [item.name, item]));
  return `<details class="data-details" ${kind === "hero" ? "open" : ""}><summary>${escapeHtml(title)} (${formatNumber(payload.length)})</summary><div class="table-wrap"><table><thead><tr><th>Name</th><th>Level</th><th>${kind === "hero" ? "Target (current Hero Hall cap)" : "Target"}</th><th>Progress</th></tr></thead><tbody>${payload.map(item => { const row = byName.get(item.name); const target = row?.thCapLevel || item.maxLevel; const globalOnly = Boolean(row?.provenanceNote); const percent = target ? Math.min(1, item.level / target) : 0; return `<tr class="${row && row.remainingLevels > 0 ? "non-maxed" : ""}"><td>${escapeHtml(item.name)}</td><td>${formatNumber(item.level)}</td><td title="${kind === "hero" ? "Cap per current Hero Hall data" : ""}">${target === undefined ? "Not exposed" : `${formatNumber(target)}${item.maxLevel === undefined ? "" : ` / ${formatNumber(item.maxLevel)}${globalOnly ? " global max" : " max"}`}`}</td><td><div class="progress"><span style="width:${safePercent(percent)}%"></span></div><small>${Math.round(percent * 100)}%</small></td></tr>`; }).join("")}</tbody></table></div></details>`;
}

function stat(label, value, detail = "") { return `<div class="stat"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value === undefined || value === null ? "Not exposed" : formatNumber(value))}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`; }
function heroEquipmentLine(player) {
  const equipment = player.heroEquipment?.length ? player.heroEquipment : player.heroes?.flatMap(hero => hero.equipment || []) || [];
  return equipment.length ? `<span class="equipment-compact">${equipment.slice(0, 5).map(item => `${escapeHtml(item.name)} ${formatNumber(item.level)}${item.maxLevel === undefined ? "" : `/${formatNumber(item.maxLevel)}`}`).join(" · ")}</span>` : "";
}
function resourceCost(cost, resource) { if (cost === undefined) return "Manual input required"; const normalized = String(resource || "").toLowerCase().replace(/[\s_]/g, ""); const kind = normalized === "darkelixir" ? "dark" : normalized === "elixir" ? "elixir" : "gold"; const labels = { darkelixir: "Dark Elixir", elixir: "Elixir", gold: "Gold" }; return `<span class="resource-dot resource-${kind}"></span>${formatNumber(cost)} ${escapeHtml(labels[normalized] || (resource ? humanizeSlug(resource) : "Resources"))}`; }
function readBase() { const number = id => document.querySelector(`#${id}`).value === "" ? undefined : Number(document.querySelector(`#${id}`).value); const selected = id => [...document.querySelectorAll(`#${id} input:checked`)].map(input => input.value); const sameArmy = document.querySelector("#sameArmy").checked; const heroLoadouts = {}; document.querySelectorAll("[data-loadout-hero]").forEach(select => { const hero = select.dataset.loadoutHero; heroLoadouts[hero] ||= { equipment: [] }; if (select.dataset.loadoutSlot === "equipment" && select.value && !heroLoadouts[hero].equipment.includes(select.value)) heroLoadouts[hero].equipment.push(select.value); if (select.dataset.loadoutSlot === "pet" && select.value) heroLoadouts[hero].pet = select.value; }); return { buildersTotal: number("buildersTotal"), buildersFree: number("buildersFree"), labBusy: document.querySelector("#labBusy").checked, resources: { gold: number("gold"), elixir: number("elixir"), darkElixir: number("darkElixir") }, oreShiny: number("oreShiny"), oreGlowy: number("oreGlowy"), oreStarry: number("oreStarry"), heroLineup: [...document.querySelectorAll("#heroLineup input:checked")].map(input => input.value), heroLoadouts, warArmy: selected("warArmy"), homeArmy: sameArmy ? selected("warArmy") : selected("homeArmy"), sameArmy, goal: document.querySelector("#goal").value }; }
function writeBase(base) { for (const id of ["buildersTotal", "buildersFree", "oreShiny", "oreGlowy", "oreStarry"]) if (base[id] !== undefined) document.querySelector(`#${id}`).value = base[id]; for (const id of ["gold", "elixir", "darkElixir"]) if (base.resources?.[id] !== undefined) document.querySelector(`#${id}`).value = base.resources[id]; document.querySelector("#labBusy").checked = Boolean(base.labBusy); if (base.goal) document.querySelector("#goal").value = base.goal; document.querySelectorAll("[data-goal]").forEach(button => button.classList.toggle("active", button.dataset.goal === base.goal)); }
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
function parseDuration(value) { const match = String(value).toLowerCase().match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/); if (!match || (!match[1] && !match[2] && !match[3])) throw new Error("Use a duration such as 1d 2h."); return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60; }
function timeUntil(value) { return humanTime(Math.max(0, Math.floor((Date.parse(value) - Date.now()) / 1000))); }
function safePercent(value) { return Math.max(0, Math.min(100, Number(value) * 100 || 0)); }
function formatNumber(value) { return typeof value === "number" ? new Intl.NumberFormat().format(value) : String(value); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date); }
function isSuperTroopName(name) { return name.startsWith("Super ") || ["Sneaky Goblin", "Ice Hound", "Inferno Dragon", "Rocket Balloon"].includes(name); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char])); }
updateAuthState();
if (playerTag.value) load();

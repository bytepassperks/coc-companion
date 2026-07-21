const apiBase = document.querySelector("#apiBase");
const playerTag = document.querySelector("#playerTag");
const status = document.querySelector("#status");
const overview = document.querySelector("#overview");
const recommendations = document.querySelector("#recommendations");
const feed = document.querySelector("#feed");
const answer = document.querySelector("#answer");
apiBase.value = localStorage.getItem("coc-api-base") || "";
playerTag.value = localStorage.getItem("coc-player-tag") || "";

document.querySelector("#load").addEventListener("click", async () => {
  const base = apiBase.value.replace(/\/$/, "");
  const tag = playerTag.value.trim();
  if (!base || !tag) return setStatus("Enter both an API base URL and player tag.");
  localStorage.setItem("coc-api-base", base);
  localStorage.setItem("coc-player-tag", tag);
  setStatus("Loading…");
  try {
    await post(`/api/watch/${encodeURIComponent(tag)}`, {});
    const [player, recs, notifications] = await Promise.all([
      get(`/api/player/${encodeURIComponent(tag)}`),
      get(`/api/recommendations/${encodeURIComponent(tag)}`),
      get(`/api/feed/${encodeURIComponent(tag)}`)
    ]);
    overview.classList.remove("hidden");
    overview.innerHTML = `<h2>${escapeHtml(player.name)}</h2><p>TH${player.townHallLevel} · ${player.trophies || 0} trophies</p><div class="heroes">${(player.heroes || []).map(hero => `<span>${escapeHtml(hero.name)} ${hero.level}</span>`).join("")}</div>`;
    recommendations.innerHTML = recs.length ? recs.map(item => `<li><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.reason)}</small></li>`).join("") : "<li>No configured recommendations.</li>";
    feed.innerHTML = notifications.length ? notifications.map(item => `<li><strong>${escapeHtml(item.type)}</strong><small>${escapeHtml(item.message)}</small></li>`).join("") : "<li>No notifications yet.</li>";
    setStatus("Loaded.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#askForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await post("/api/ask", { tag: playerTag.value.trim(), question: document.querySelector("#question").value });
    answer.textContent = result.answer;
  } catch (error) {
    answer.textContent = error.message;
  }
});

async function get(path) {
  const response = await fetch(apiBase.value.replace(/\/$/, "") + path);
  return parse(response);
}
async function post(path, body) {
  const response = await fetch(apiBase.value.replace(/\/$/, "") + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return parse(response);
}
async function parse(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
function setStatus(value) { status.textContent = value; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char])); }

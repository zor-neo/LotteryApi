const state = {
  timer: null,
  lastRevision: null,
  lastDrawDate: null,
};

const el = {
  apiBaseUrl: document.querySelector("#apiBaseUrl"),
  apiKey: document.querySelector("#apiKey"),
  drawDate: document.querySelector("#drawDate"),
  pollSeconds: document.querySelector("#pollSeconds"),
  refreshNow: document.querySelector("#refreshNow"),
  togglePolling: document.querySelector("#togglePolling"),
  connectionStatus: document.querySelector("#connectionStatus"),
  summary: document.querySelector("#summary"),
  drawStatus: document.querySelector("#drawStatus"),
  revision: document.querySelector("#revision"),
  rowCount: document.querySelector("#rowCount"),
  lastPoll: document.querySelector("#lastPoll"),
  primaryProvider: document.querySelector("#primaryProvider"),
  providers: document.querySelector("#providers"),
  categories: document.querySelector("#categories"),
  revisionNote: document.querySelector("#revisionNote"),
  eventLog: document.querySelector("#eventLog"),
  clearLog: document.querySelector("#clearLog"),
};

el.drawDate.value = bangkokDate();
el.apiKey.value = localStorage.getItem("lottery_api_key") || "";

el.apiKey.addEventListener("change", () => {
  localStorage.setItem("lottery_api_key", el.apiKey.value.trim());
});
el.refreshNow.addEventListener("click", () => void loadResult());
el.togglePolling.addEventListener("click", togglePolling);
el.clearLog.addEventListener("click", () => {
  el.eventLog.innerHTML = "";
});

void loadHealth();

async function loadHealth() {
  try {
    const data = await fetchJson("/v1/health", false);
    setConnection("ok", data.ok ? "API online" : "API degraded");
    el.summary.textContent = `${data.service} | ${data.runtime} | database ${data.database}`;
  } catch (error) {
    setConnection("bad", "Health failed");
    logEvent(error.message || "Health failed");
  }
}

async function loadResult() {
  try {
    setConnection("warn", "Refreshing");
    const drawDate = el.drawDate.value;
    const path = drawDate ? `/v1/results/${drawDate}` : "/v1/results/latest";
    const data = await fetchJson(path, true);
    renderResult(data);
    setConnection(statusTone(data.status), data.status);
  } catch (error) {
    setConnection("bad", "Request failed");
    logEvent(error.message || "Request failed");
  }
}

async function fetchJson(path, auth) {
  const baseUrl = el.apiBaseUrl.value.replace(/\/$/, "");
  const headers = {};
  if (auth) {
    const key = el.apiKey.value.trim();
    if (!key) throw new Error("Add x-api-key first");
    headers["x-api-key"] = key;
  }
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function renderResult(result) {
  const total = result.categories.reduce((sum, category) => sum + category.received_count, 0);
  const expected = result.categories.reduce((sum, category) => sum + category.expected_count, 0);
  const revisionChanged = result.draw_date !== state.lastDrawDate || result.revision !== state.lastRevision;

  el.drawStatus.textContent = result.status;
  el.revision.textContent = String(result.revision);
  el.rowCount.textContent = `${total}/${expected}`;
  el.lastPoll.textContent = result.last_poll_at ? new Date(result.last_poll_at).toLocaleTimeString() : "-";
  el.primaryProvider.textContent = result.primary_provider || "sanook";
  el.revisionNote.textContent = revisionChanged ? "Revision changed, repaint like a consumer" : "No revision change";

  renderProviders(result.providers || []);
  renderCategories(result.categories || []);

  if (revisionChanged) {
    logEvent(`${result.draw_date || "no-date"} revision ${result.revision}: ${result.status}, ${total}/${expected} rows`);
    state.lastRevision = result.revision;
    state.lastDrawDate = result.draw_date;
  }
}

function renderProviders(providers) {
  el.providers.innerHTML = providers.map((provider) => `
    <article class="provider-card">
      <div class="provider-top">
        <strong>${escapeHtml(provider.provider)}</strong>
        <span class="pill ${escapeHtml(provider.status)}">${escapeHtml(provider.status)}</span>
      </div>
      <p>${provider.row_count} rows | ${provider.source_date || "no source date"}</p>
      <small>${escapeHtml(provider.message || "No message")}</small>
    </article>
  `).join("");
}

function renderCategories(categories) {
  el.categories.innerHTML = categories.map((category) => `
    <article class="category">
      <div class="category-head">
        <h2>${escapeHtml(category.label)}</h2>
        <span>${category.received_count}/${category.expected_count}</span>
      </div>
      <div class="numbers">
        ${category.numbers.length ? category.numbers.map((number) => `
          <span class="number ${escapeHtml(number.status)}" title="Provider: ${escapeHtml(number.source_provider)} | Seen by: ${escapeHtml(number.all_seen_providers.join(", "))}">
            ${escapeHtml(number.number)}
          </span>
        `).join("") : '<span class="empty">Waiting</span>'}
      </div>
    </article>
  `).join("");
}

function togglePolling() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
    el.togglePolling.textContent = "Start polling";
    setConnection("ok", "Polling stopped");
    return;
  }

  void loadResult();
  const seconds = Math.max(5, Number(el.pollSeconds.value || 10));
  state.timer = setInterval(() => void loadResult(), seconds * 1000);
  el.togglePolling.textContent = "Stop polling";
  setConnection("warn", `Polling every ${seconds}s`);
}

function setConnection(tone, text) {
  el.connectionStatus.className = `status-pill ${tone}`;
  el.connectionStatus.textContent = text;
}

function statusTone(status) {
  if (status === "confirmed" || status === "complete") return "ok";
  if (status === "conflict" || status === "failed" || status === "error") return "bad";
  return "warn";
}

function logEvent(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  el.eventLog.prepend(item);
}

function bangkokDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

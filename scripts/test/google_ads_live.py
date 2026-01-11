import os
import time
from datetime import date, timedelta
from typing import Optional
try:
    from dotenv import load_dotenv
except ModuleNotFoundError as exc:
    raise SystemExit("Missing dependency: python-dotenv. Install with `pip install python-dotenv`.") from exc

try:
    from flask import Flask, redirect, request, url_for, render_template_string, session, jsonify
except ModuleNotFoundError as exc:
    raise SystemExit("Missing dependency: Flask. Install with `pip install Flask`.") from exc

try:
    from google_auth_oauthlib.flow import Flow
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Missing dependency: google-auth-oauthlib. Install with `pip install google-auth-oauthlib`."
    ) from exc

try:
    from google.ads.googleads.client import GoogleAdsClient
    from google.ads.googleads.errors import GoogleAdsException
except ModuleNotFoundError as exc:
    raise SystemExit("Missing dependency: google-ads. Install with `pip install google-ads`.") from exc


# -----------------------------
# ENV + CONFIG
# -----------------------------
load_dotenv()

# Allow OAuth over http for LOCALHOST ONLY (dev demo)
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

SCOPES = [
    "https://www.googleapis.com/auth/adwords",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

def require_env(key: str) -> str:
    v = os.getenv(key, "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {key}")
    return v

def require_numeric(value: str, field_name: str) -> str:
    if not value.isdigit():
        raise ValueError(f"{field_name} must be numeric.")
    return value

GOOGLE_OAUTH_CLIENT_ID = require_env("GOOGLE_OAUTH_CLIENT_ID")
GOOGLE_OAUTH_CLIENT_SECRET = require_env("GOOGLE_OAUTH_CLIENT_SECRET")
GOOGLE_ADS_DEVELOPER_TOKEN = require_env("GOOGLE_ADS_DEVELOPER_TOKEN")

# Must match your OAuth client redirect URI in Google Cloud Console
REDIRECT_URI = "http://localhost:8000/oauth2callback"


# -----------------------------
# FLASK APP
# -----------------------------
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-only-change-me")  # demo only


# -----------------------------
# TEMPLATES (simple clean UI)
# -----------------------------
BASE_CSS = """
<style>
  :root { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
  body { max-width: 980px; margin: 32px auto; padding: 0 16px; color: #111; }
  .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 14px; }
  h1,h2 { margin: 0 0 10px 0; }
  p { margin: 8px 0; color: #374151; }
  .btn { display:inline-flex; gap:8px; align-items:center; border: 1px solid #111827; background:#111827; color:white; padding:10px 14px; border-radius: 10px; text-decoration:none; cursor:pointer; }
  .btn.secondary { background:white; color:#111827; }
  .row { display:flex; gap: 12px; flex-wrap: wrap; align-items:center; }
  select, input { border:1px solid #d1d5db; border-radius: 10px; padding: 10px 12px; min-width: 320px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align:left; border-top: 1px solid #e5e7eb; padding: 10px 8px; vertical-align: top; }
  th { color:#374151; font-weight: 600; }
  .muted { color:#6b7280; font-size: 13px; }
  .pill { display:inline-block; padding: 2px 8px; border-radius: 999px; background:#f3f4f6; color:#111827; font-size:12px; border:1px solid #e5e7eb; }
  .ok { background:#ecfdf5; border-color:#a7f3d0; color:#065f46; }
  .warn { background:#fffbeb; border-color:#fde68a; color:#92400e; }
  .bad { background:#fef2f2; border-color:#fecaca; color:#991b1b; }
  .spinner { width: 18px; height: 18px; border: 2px solid #e5e7eb; border-top-color:#111827; border-radius: 50%; display:inline-block; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  details { border:1px solid #e5e7eb; border-radius: 12px; padding: 10px 12px; margin-top: 10px; background:#fafafa; }
  summary { cursor:pointer; font-weight: 600; }
  code { background:#f3f4f6; padding:2px 6px; border-radius: 8px; }
  .tabs { display:flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .tab-btn { border:1px solid #d1d5db; background:#fff; color:#111827; padding:6px 10px; border-radius:8px; cursor:pointer; }
  .tab-btn.active { background:#111827; color:#fff; border-color:#111827; }
  .tab-content { display:none; margin-top: 10px; }
  .tab-content.active { display:block; }
</style>
"""

INDEX_HTML = BASE_CSS + """
<div class="card">
  <h1>Google OAuth → Google Ads Spend Report (Local Demo)</h1>
  <p>This demo logs in with Google, then lists accessible Google Ads accounts, detects MCC vs non-MCC, and fetches spend.</p>
  <div class="row">
    <a class="btn" href="/login">Login with Google</a>
    <a class="btn secondary" href="/logout">Reset session</a>
  </div>
  <p class="muted" style="margin-top:12px;">
    Uses scopes: <code>adwords</code>, <code>openid</code>, <code>userinfo.email</code>, <code>userinfo.profile</code>
  </p>
</div>
"""

ACCOUNTS_HTML = BASE_CSS + """
<div class="card">
  <h2>Select a Google Ads account</h2>
  <p class="muted">These are accounts accessible by the Google user you just authenticated.</p>

  {% if error %}
    <p><span class="pill bad">Error</span> {{ error }}</p>
  {% endif %}

  {% if accounts and accounts|length > 0 %}
  <form method="GET" action="/report">
    <div class="row">
      <select name="customer_id" required>
        {% for a in accounts %}
          <option value="{{ a.id }}">
            {{ a.name }} ({{ a.id }}) — {{ "MCC" if a.manager else "Single" }}
          </option>
        {% endfor %}
      </select>
      <button class="btn" type="submit">Generate report</button>
      <a class="btn secondary" href="/logout">Logout</a>
    </div>
  </form>
  <p class="muted" style="margin-top:10px;">
    If an account is labeled <b>MCC</b>, selecting it will loop through its child accounts (leaf accounts).
  </p>
  {% else %}
    <p><span class="pill warn">No accounts found</span> If you expected accounts, ensure this Google user has Google Ads access.</p>
  {% endif %}
</div>
"""

REPORT_HTML = BASE_CSS + """
<div class="card">
  <div class="row" style="justify-content:space-between;">
    <div>
      <h2>Spend report</h2>
      <p class="muted">Customer ID: <code>{{ customer_id }}</code></p>
    </div>
    <div class="row">
      <a class="btn secondary" href="/accounts">Back</a>
      <a class="btn secondary" href="/logout">Logout</a>
    </div>
  </div>

  <div class="row" style="margin-top:10px;">
    <label class="muted" for="days">Days to fetch</label>
    <input id="days" type="number" min="1" max="730" value="7" />
    <label class="muted" for="level">View level</label>
    <select id="level">
      <option value="account" selected>Account (daily)</option>
      <option value="campaign">Campaign (breakdown)</option>
    </select>
    <button class="btn" type="button" id="run-btn">Run report</button>
  </div>

  <div class="row" id="loading-row" style="margin-top:10px; display:none;">
    <span class="spinner"></span>
    <p style="margin:0;">Fetching data… <span class="muted">Elapsed: <span id="elapsed">0.0</span>s</span></p>
  </div>

  <div id="result" style="margin-top:14px;"></div>
</div>

<script>
  let t0 = performance.now();
  let timer = null;

  function startTimer() {
    t0 = performance.now();
    const row = document.getElementById("loading-row");
    if (row) row.style.display = "flex";
    timer = setInterval(() => {
      let dt = (performance.now() - t0) / 1000;
      document.getElementById("elapsed").textContent = dt.toFixed(1);
    }, 100);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    const row = document.getElementById("loading-row");
    if (row) row.style.display = "none";
  }

  async function run() {
    startTimer();
    const customerId = "{{ customer_id }}";
    const days = document.getElementById("days").value || "7";
    const level = document.getElementById("level").value;
    const endpoint = level === "campaign" ? "/api/campaigns" : "/api/report";
    const resp = await fetch(`${endpoint}?customer_id=${encodeURIComponent(customerId)}&days=${encodeURIComponent(days)}`);
    const data = await resp.json();

    stopTimer();

    if (!resp.ok || data.error) {
      document.getElementById("result").innerHTML = `
        <p><span class="pill bad">Failed</span> ${data.error || "Unknown error"}</p>
        <p class="muted">Elapsed (server): ${(data.elapsed_seconds ?? 0).toFixed(2)}s</p>
      `;
      return;
    }

    const pill = (kind) => {
      if (kind === "mcc") return '<span class="pill ok">MCC</span>';
      if (kind === "single") return '<span class="pill ok">Single account</span>';
      if (kind === "campaign") return '<span class="pill ok">Campaign level</span>';
      return '<span class="pill">Unknown</span>';
    };

    let html = `
      <p>${pill(data.kind)} <span class="muted">Elapsed (server): ${data.elapsed_seconds.toFixed(2)}s</span></p>
      <p class="muted">Time range: last <code>${data.days}</code> days (includes today).</p>
    `;

    if (data.kind === "single") {
      html += renderSingle(data);
    } else if (data.kind === "mcc") {
      html += renderMcc(data);
    } else if (data.kind === "campaign") {
      html += renderCampaigns(data);
    }

    document.getElementById("result").innerHTML = html;

    if (data.kind === "campaign") {
      window.currentCustomerId = customerId;
      window.currentDays = days;
      wireCampaignDetails();
    }
  }

  function money(n) {
    if (n === null || n === undefined) return "-";
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderDailyTable(rows, currency) {
    let total = rows.reduce((s, r) => s + r.cost, 0);
    let totalImpr = rows.reduce((s, r) => s + (r.impressions || 0), 0);
    let totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    let totalConv = rows.reduce((s, r) => s + (r.conversions || 0), 0);
    let t = `
      <div class="card" style="margin-top:14px;">
        <div class="row" style="justify-content:space-between;">
          <div><b>Daily spend</b> <span class="muted">(${currency})</span></div>
          <div>
            <span class="pill">Total: ${money(total)} ${currency}</span>
            <span class="pill">Impr: ${totalImpr.toLocaleString()}</span>
            <span class="pill">Clicks: ${totalClicks.toLocaleString()}</span>
            <span class="pill">Conv: ${money(totalConv)}</span>
          </div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Spend</th><th>Impressions</th><th>Clicks</th><th>Conversions</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr><td>${r.date}</td><td>${money(r.cost)} ${currency}</td><td>${(r.impressions || 0).toLocaleString()}</td><td>${(r.clicks || 0).toLocaleString()}</td><td>${money(r.conversions || 0)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
    return t;
  }

  function renderSingle(data) {
    let html = `
      <div class="card" style="margin-top:14px;">
        <p style="margin:0;"><b>${data.account.name}</b> <span class="muted">(${data.account.id})</span></p>
        <p class="muted">Currency: <code>${data.account.currency_code}</code></p>
      </div>
    `;
    html += renderDailyTable(data.daily_rows, data.account.currency_code);
    return html;
  }

  function renderMcc(data) {
    let html = `
      <div class="card" style="margin-top:14px;">
        <p style="margin:0;"><b>${data.manager.name}</b> <span class="muted">(${data.manager.id})</span></p>
        <p class="muted">Leaf accounts found: <b>${data.children.length}</b></p>
      </div>
      <div class="card">
        <b>Summary (total per account)</b>
        <table>
          <thead><tr><th>Account</th><th>Total</th><th>Impr</th><th>Clicks</th><th>Conv</th><th>Currency</th></tr></thead>
          <tbody>
            ${data.children.map(c => `
              <tr>
                <td>${c.name} <span class="muted">(${c.id})</span></td>
                <td>${money(c.total_cost)} ${c.currency_code}</td>
                <td>${(c.total_impressions || 0).toLocaleString()}</td>
                <td>${(c.total_clicks || 0).toLocaleString()}</td>
                <td>${money(c.total_conversions || 0)}</td>
                <td>${c.currency_code}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Optional daily breakdown
    html += data.children.map(c => `
      <details>
        <summary>${c.name} <span class="muted">(${c.id})</span> — daily breakdown</summary>
        ${renderDailyTable(c.daily_rows, c.currency_code)}
      </details>
    `).join("");

    return html;
  }

  function renderCampaigns(data) {
    if (!data.campaigns || data.campaigns.length === 0) {
      return `
        <div class="card" style="margin-top:14px;">
          <p style="margin:0;"><b>${data.account.name}</b> <span class="muted">(${data.account.id})</span></p>
          <p class="muted">Currency: <code>${data.account.currency_code}</code></p>
        </div>
        <div class="card">
          <p class="muted">No campaigns with spend > 0.01 found in this range.</p>
        </div>
      `;
    }
    let html = `
      <div class="card" style="margin-top:14px;">
        <p style="margin:0;"><b>${data.account.name}</b> <span class="muted">(${data.account.id})</span></p>
        <p class="muted">Currency: <code>${data.account.currency_code}</code></p>
      </div>
      <div class="card">
        <b>Campaigns (total over range)</b>
        <table>
          <thead><tr><th>Campaign</th><th>Type</th><th>Spend</th><th>Impr</th><th>Clicks</th><th>Conv</th></tr></thead>
          <tbody>
            ${data.campaigns.map(c => `
              <tr>
                <td>
                  <button class="tab-btn campaign-link" data-campaign-id="${c.id}" data-campaign-name="${c.name}">
                    ${c.name}
                  </button>
                  <span class="muted">(${c.id})</span>
                </td>
                <td>${c.channel_type}</td>
                <td>${money(c.total_cost)} ${data.account.currency_code}</td>
                <td>${(c.total_impressions || 0).toLocaleString()}</td>
                <td>${(c.total_clicks || 0).toLocaleString()}</td>
                <td>${money(c.total_conversions || 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="card" id="campaign-adgroups">
        <p class="muted">Click a campaign name to load its ad groups.</p>
      </div>
    `;
    return html;
  }

  function renderAdGroups(adGroups, currency) {
    if (!adGroups || adGroups.length === 0) {
      return "<p class=\\"muted\\">No ad groups found for this campaign.</p>";
    }
    return adGroups.map(ag => `
      <details class="adgroup" data-ad-group-id="${ag.id}">
        <summary>${ag.name} <span class="muted">(${ag.id})</span> — ${money(ag.total_cost)} ${currency}</summary>
        <div class="muted" style="margin-top:6px;">Impr ${ag.total_impressions.toLocaleString()} • Clicks ${ag.total_clicks.toLocaleString()} • Conv ${money(ag.total_conversions)}</div>
        <div class="tabs">
          <button class="tab-btn" data-tab="ads">Ads</button>
          <button class="tab-btn" data-tab="keywords">Keywords</button>
        </div>
        <div class="tab-content" data-tab="ads"></div>
        <div class="tab-content" data-tab="keywords"></div>
      </details>
    `).join("");
  }

  function renderAds(ads, currency) {
    if (!ads || ads.length === 0) {
      return "<p class=\\"muted\\">No ads found for this ad group.</p>";
    }
    const totalCost = ads.reduce((s, a) => s + (a.cost || 0), 0);
    const totalImpr = ads.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalClicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);
    const totalConv = ads.reduce((s, a) => s + (a.conversions || 0), 0);
    return `
      <div class="row" style="justify-content:space-between;">
        <div class="muted">Totals</div>
        <div>
          <span class="pill">Total: ${money(totalCost)} ${currency}</span>
          <span class="pill">Impr: ${totalImpr.toLocaleString()}</span>
          <span class="pill">Clicks: ${totalClicks.toLocaleString()}</span>
          <span class="pill">Conv: ${money(totalConv)}</span>
        </div>
      </div>
      <table>
        <thead><tr><th>Ad ID</th><th>Type</th><th>Spend</th><th>Impr</th><th>Clicks</th><th>Conv</th></tr></thead>
        <tbody>
          ${ads.map(a => `
            <tr>
              <td>${a.id}</td>
              <td>${a.ad_type}</td>
              <td>${money(a.cost)} ${currency}</td>
              <td>${(a.impressions || 0).toLocaleString()}</td>
              <td>${(a.clicks || 0).toLocaleString()}</td>
              <td>${money(a.conversions || 0)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderKeywords(keywords, currency) {
    if (!keywords || keywords.length === 0) {
      return "<p class=\\"muted\\">No keywords found for this ad group.</p>";
    }
    const totalCost = keywords.reduce((s, k) => s + (k.cost || 0), 0);
    const totalImpr = keywords.reduce((s, k) => s + (k.impressions || 0), 0);
    const totalClicks = keywords.reduce((s, k) => s + (k.clicks || 0), 0);
    const totalConv = keywords.reduce((s, k) => s + (k.conversions || 0), 0);
    return `
      <div class="row" style="justify-content:space-between;">
        <div class="muted">Totals</div>
        <div>
          <span class="pill">Total: ${money(totalCost)} ${currency}</span>
          <span class="pill">Impr: ${totalImpr.toLocaleString()}</span>
          <span class="pill">Clicks: ${totalClicks.toLocaleString()}</span>
          <span class="pill">Conv: ${money(totalConv)}</span>
        </div>
      </div>
      <table>
        <thead><tr><th>Keyword</th><th>Match</th><th>Spend</th><th>Impr</th><th>Clicks</th><th>Conv</th></tr></thead>
        <tbody>
          ${keywords.map(k => `
            <tr>
              <td>${k.text}</td>
              <td>${k.match_type}</td>
              <td>${money(k.cost)} ${currency}</td>
              <td>${(k.impressions || 0).toLocaleString()}</td>
              <td>${(k.clicks || 0).toLocaleString()}</td>
              <td>${money(k.conversions || 0)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  async function wireCampaignDetails() {
    const container = document.getElementById("result");
    const target = document.getElementById("campaign-adgroups");
    if (!container || !target) return;

    container.addEventListener("click", async (event) => {
      const btn = event.target.closest(".campaign-link");
      if (!btn) return;
      event.preventDefault();
      const campaignId = btn.dataset.campaignId;
      const campaignName = btn.dataset.campaignName || "Campaign";
      if (!campaignId) return;

      const all = container.querySelectorAll(".campaign-link");
      all.forEach(el => el.classList.toggle("active", el === btn));

      target.innerHTML = `<p class="muted">Loading ad groups for <b>${campaignName}</b>…</p>`;
      try {
        const resp = await fetch(`/api/ad-groups?customer_id=${encodeURIComponent(window.currentCustomerId)}&campaign_id=${encodeURIComponent(campaignId)}&days=${encodeURIComponent(window.currentDays)}`);
        const data = await resp.json();
        if (!resp.ok || data.error) {
          target.innerHTML = `<p><span class="pill bad">Failed</span> ${data.error || "Unknown error"}</p>`;
          return;
        }
        target.innerHTML = `
          <div class="row" style="justify-content:space-between;">
            <div><b>Ad groups</b> <span class="muted">(${campaignName})</span></div>
            <div class="muted">Count: ${data.ad_groups.length}</div>
          </div>
          ${renderAdGroups(data.ad_groups, data.currency_code)}
        `;
        wireAdGroupDetails(target, data.currency_code);
      } catch (err) {
        target.innerHTML = `<p><span class="pill bad">Failed</span> ${err}</p>`;
      }
    });
  }

  function wireAdGroupDetails(root, currency) {
    const detailsList = root.querySelectorAll("details.adgroup");
    for (const details of detailsList) {
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        const adsBtn = details.querySelector(".tab-btn[data-tab='ads']");
        if (adsBtn && !details.dataset.initialized) {
          details.dataset.initialized = "true";
          activateTab(details, "ads", currency);
        }
      });
      const buttons = details.querySelectorAll(".tab-btn");
      buttons.forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          activateTab(details, btn.dataset.tab, currency);
        });
      });
    }
  }

  async function activateTab(details, tabName, currency) {
    const buttons = details.querySelectorAll(".tab-btn");
    buttons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabName));
    const panels = details.querySelectorAll(".tab-content");
    panels.forEach(panel => panel.classList.toggle("active", panel.dataset.tab === tabName));

    const panel = details.querySelector(`.tab-content[data-tab='${tabName}']`);
    if (!panel || panel.dataset.status === "loaded") return;

    panel.dataset.status = "loading";
    panel.innerHTML = "<p class=\\"muted\\">Loading…</p>";
    const adGroupId = details.dataset.adGroupId;
    const endpoint = tabName === "ads" ? "/api/ads" : "/api/keywords";
    try {
      const resp = await fetch(`${endpoint}?customer_id=${encodeURIComponent(window.currentCustomerId)}&ad_group_id=${encodeURIComponent(adGroupId)}&days=${encodeURIComponent(window.currentDays)}`);
      const data = await resp.json();
      if (!resp.ok || data.error) {
        panel.innerHTML = `<p><span class="pill bad">Failed</span> ${data.error || "Unknown error"}</p>`;
        panel.dataset.status = "error";
        return;
      }
      panel.innerHTML = tabName === "ads" ? renderAds(data.ads, currency) : renderKeywords(data.keywords, currency);
      panel.dataset.status = "loaded";
    } catch (err) {
      panel.innerHTML = `<p><span class="pill bad">Failed</span> ${err}</p>`;
      panel.dataset.status = "error";
    }
  }

  document.getElementById("run-btn").addEventListener("click", run);
  run();
</script>
"""


# -----------------------------
# OAUTH FLOW HELPERS
# -----------------------------
def build_flow(state=None):
    client_config = {
        "web": {
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }
    }
    return Flow.from_client_config(
        client_config=client_config,
        scopes=SCOPES,
        state=state,
        redirect_uri=REDIRECT_URI,
    )


# -----------------------------
# GOOGLE ADS HELPERS
# -----------------------------
def build_googleads_client(refresh_token: str, login_customer_id: Optional[str] = None) -> GoogleAdsClient:
    cfg = {
        "developer_token": GOOGLE_ADS_DEVELOPER_TOKEN,
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
        "refresh_token": refresh_token,
        "use_proto_plus": True,
    }
    if login_customer_id:
        cfg["login_customer_id"] = login_customer_id  # helps when accessing child accounts via MCC
    return GoogleAdsClient.load_from_dict(cfg)

def list_accessible_customer_ids(client: GoogleAdsClient) -> list[str]:
    svc = client.get_service("CustomerService")
    resp = svc.list_accessible_customers()
    # resource names look like: "customers/1234567890"
    ids = [rn.split("/")[-1] for rn in resp.resource_names]
    return ids

def fetch_customer_meta(client: GoogleAdsClient, customer_id: str) -> dict:
    ga_service = client.get_service("GoogleAdsService")
    query = """
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.manager,
        customer.currency_code
      FROM customer
      LIMIT 1
    """
    resp = ga_service.search(customer_id=customer_id, query=query)
    row = next(iter(resp), None)
    if not row:
        return {"id": customer_id, "name": "(unknown)", "manager": None, "currency_code": "N/A"}
    c = row.customer
    return {
        "id": str(c.id),
        "name": c.descriptive_name or "(no name)",
        "manager": bool(c.manager),
        "currency_code": c.currency_code or "N/A",
    }

def fetch_daily_spend(client: GoogleAdsClient, customer_id: str, last_n_days: int) -> list[dict]:
    ga_service = client.get_service("GoogleAdsService")

    days = max(1, min(int(last_n_days), 730))
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)

    # Account-level daily spend
    query = f"""
      SELECT
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM customer
      WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
      ORDER BY segments.date
    """
    resp = ga_service.search(customer_id=customer_id, query=query)

    # Aggregate per day (just in case multiple rows appear)
    daily = {}
    for row in resp:
        d = row.segments.date  # YYYY-MM-DD
        cost = (row.metrics.cost_micros or 0) / 1_000_000.0
        entry = daily.get(d, {"cost": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0})
        entry["cost"] += cost
        entry["impressions"] += int(row.metrics.impressions or 0)
        entry["clicks"] += int(row.metrics.clicks or 0)
        entry["conversions"] += float(row.metrics.conversions or 0)
        daily[d] = entry

    # Return sorted rows
    return [{"date": d, **daily[d]} for d in sorted(daily.keys())]

def fetch_campaigns(client: GoogleAdsClient, customer_id: str, last_n_days: int) -> list[dict]:
    ga_service = client.get_service("GoogleAdsService")
    days = max(1, min(int(last_n_days), 730))
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)
    query = f"""
      SELECT
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
        AND campaign.status != 'REMOVED'
    """
    resp = ga_service.search(customer_id=customer_id, query=query)

    campaigns = {}
    for row in resp:
        cid = str(row.campaign.id)
        channel = row.campaign.advertising_channel_type
        if channel is None:
            channel_name = "UNKNOWN"
        else:
            channel_name = channel.name if hasattr(channel, "name") else str(channel)
        entry = campaigns.get(cid, {
            "id": cid,
            "name": row.campaign.name or "(no name)",
            "channel_type": channel_name,
            "total_cost": 0.0,
            "total_impressions": 0,
            "total_clicks": 0,
            "total_conversions": 0.0,
        })
        entry["total_cost"] += (row.metrics.cost_micros or 0) / 1_000_000.0
        entry["total_impressions"] += int(row.metrics.impressions or 0)
        entry["total_clicks"] += int(row.metrics.clicks or 0)
        entry["total_conversions"] += float(row.metrics.conversions or 0)
        campaigns[cid] = entry

    filtered = [c for c in campaigns.values() if c["total_cost"] > 0.01]
    return sorted(filtered, key=lambda c: c["total_cost"], reverse=True)

def fetch_ad_groups(
    client: GoogleAdsClient,
    customer_id: str,
    campaign_id: str,
    last_n_days: int,
) -> list[dict]:
    ga_service = client.get_service("GoogleAdsService")
    days = max(1, min(int(last_n_days), 730))
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)
    query = f"""
      SELECT
        ad_group.id,
        ad_group.name,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM ad_group
      WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
        AND campaign.id = {campaign_id}
        AND ad_group.status != 'REMOVED'
    """
    resp = ga_service.search(customer_id=customer_id, query=query)

    ad_groups = {}
    for row in resp:
        agid = str(row.ad_group.id)
        entry = ad_groups.get(agid, {
            "id": agid,
            "name": row.ad_group.name or "(no name)",
            "total_cost": 0.0,
            "total_impressions": 0,
            "total_clicks": 0,
            "total_conversions": 0.0,
        })
        entry["total_cost"] += (row.metrics.cost_micros or 0) / 1_000_000.0
        entry["total_impressions"] += int(row.metrics.impressions or 0)
        entry["total_clicks"] += int(row.metrics.clicks or 0)
        entry["total_conversions"] += float(row.metrics.conversions or 0)
        ad_groups[agid] = entry

    return sorted(ad_groups.values(), key=lambda a: a["total_cost"], reverse=True)

def fetch_ads(
    client: GoogleAdsClient,
    customer_id: str,
    ad_group_id: str,
    last_n_days: int,
) -> list[dict]:
    ga_service = client.get_service("GoogleAdsService")
    days = max(1, min(int(last_n_days), 730))
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)
    query = f"""
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM ad_group_ad
      WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
        AND ad_group.id = {ad_group_id}
        AND ad_group_ad.status != 'REMOVED'
    """
    resp = ga_service.search(customer_id=customer_id, query=query)

    ads = {}
    for row in resp:
        ad_id = str(row.ad_group_ad.ad.id)
        ad_type = row.ad_group_ad.ad.type_
        if ad_type is None:
            ad_type_name = "UNKNOWN"
        else:
            ad_type_name = ad_type.name if hasattr(ad_type, "name") else str(ad_type)
        entry = ads.get(ad_id, {
            "id": ad_id,
            "ad_type": ad_type_name,
            "cost": 0.0,
            "impressions": 0,
            "clicks": 0,
            "conversions": 0.0,
        })
        entry["cost"] += (row.metrics.cost_micros or 0) / 1_000_000.0
        entry["impressions"] += int(row.metrics.impressions or 0)
        entry["clicks"] += int(row.metrics.clicks or 0)
        entry["conversions"] += float(row.metrics.conversions or 0)
        ads[ad_id] = entry

    return sorted(ads.values(), key=lambda a: a["cost"], reverse=True)

def fetch_keywords(
    client: GoogleAdsClient,
    customer_id: str,
    ad_group_id: str,
    last_n_days: int,
) -> list[dict]:
    ga_service = client.get_service("GoogleAdsService")
    days = max(1, min(int(last_n_days), 730))
    end_date = date.today()
    start_date = end_date - timedelta(days=days - 1)
    query = f"""
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM keyword_view
      WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
        AND ad_group.id = {ad_group_id}
        AND ad_group_criterion.type = KEYWORD
        AND ad_group_criterion.status != 'REMOVED'
    """
    resp = ga_service.search(customer_id=customer_id, query=query)

    keywords = {}
    for row in resp:
        text = row.ad_group_criterion.keyword.text or "(not set)"
        match = row.ad_group_criterion.keyword.match_type
        if match is None:
            match_name = "UNKNOWN"
        else:
            match_name = match.name if hasattr(match, "name") else str(match)
        key = f"{text}::{match_name}"
        entry = keywords.get(key, {
            "text": text,
            "match_type": match_name,
            "cost": 0.0,
            "impressions": 0,
            "clicks": 0,
            "conversions": 0.0,
        })
        entry["cost"] += (row.metrics.cost_micros or 0) / 1_000_000.0
        entry["impressions"] += int(row.metrics.impressions or 0)
        entry["clicks"] += int(row.metrics.clicks or 0)
        entry["conversions"] += float(row.metrics.conversions or 0)
        keywords[key] = entry

    return sorted(keywords.values(), key=lambda k: k["cost"], reverse=True)

def list_leaf_accounts_under_manager(
    refresh_token: str,
    manager_customer_id: str,
) -> list[dict]:
    """
    Recursively discover all leaf (non-manager) accounts under a manager.
    Uses login_customer_id = top manager id for stable access headers.
    """
    client = build_googleads_client(refresh_token, login_customer_id=manager_customer_id)
    ga_service = client.get_service("GoogleAdsService")

    seen_managers = set()
    leaf_accounts: dict[str, dict] = {}

    queue = [manager_customer_id]

    while queue:
        current_manager = queue.pop(0)
        if current_manager in seen_managers:
            continue
        seen_managers.add(current_manager)

        query = """
          SELECT
            customer_client.id,
            customer_client.descriptive_name,
            customer_client.manager,
            customer_client.currency_code
          FROM customer_client
          WHERE customer_client.level <= 1
        """
        resp = ga_service.search(customer_id=current_manager, query=query)

        for row in resp:
            cc = row.customer_client
            cid = str(cc.id)
            meta = {
                "id": cid,
                "name": cc.descriptive_name or "(no name)",
                "manager": bool(cc.manager),
                "currency_code": cc.currency_code or "N/A",
            }
            if meta["manager"]:
                # a sub-manager (MCC)
                queue.append(cid)
            else:
                leaf_accounts[cid] = meta

    return list(leaf_accounts.values())


# -----------------------------
# ROUTES
# -----------------------------
@app.get("/")
def index():
    return render_template_string(INDEX_HTML)

@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

@app.get("/login")
def login():
    flow = build_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",          # request refresh token
        include_granted_scopes="true",
        prompt="consent",               # helps ensure refresh token is returned
    )
    session["oauth_state"] = state
    return redirect(auth_url)

@app.get("/oauth2callback")
def oauth2callback():
    state = request.args.get("state")
    expected = session.get("oauth_state")
    if expected and state != expected:
        return "Invalid state. Please /logout then try again.", 400

    flow = build_flow(state=state)
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials

    refresh_token = creds.refresh_token
    access_token = creds.token

    # Store refresh token server-side (demo session)
    session["refresh_token"] = refresh_token or ""
    session["access_token"] = access_token or ""

    if not refresh_token:
        # Still redirect to accounts, but user will see an error there
        session["oauth_warning"] = (
            "refresh_token is empty. Common causes:\n"
            "1) You already consented before (Google may not re-issue refresh_token)\n"
            "2) Redirect URI mismatch / wrong OAuth client type\n"
            "Fix: revoke access in Google Account permissions, then login again."
        )
    else:
        session.pop("oauth_warning", None)

    return redirect(url_for("accounts"))

@app.get("/accounts")
def accounts():
    refresh_token = session.get("refresh_token", "")
    warning = session.get("oauth_warning")

    if not refresh_token:
        return render_template_string(
            ACCOUNTS_HTML,
            accounts=[],
            error=warning or "No refresh_token in session. Click Login again.",
        )

    t0 = time.perf_counter()
    try:
        client = build_googleads_client(refresh_token)
        ids = list_accessible_customer_ids(client)

        # Get name + manager flag (may take a bit if many accounts)
        accounts_meta = []
        skipped_errors = []
        for cid in ids:
            try:
                meta = fetch_customer_meta(client, cid)
                accounts_meta.append(meta)
            except GoogleAdsException as e:
                failure = getattr(e, "failure", None)
                if failure and getattr(failure, "errors", None):
                    msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
                else:
                    msg = str(e)
                skipped_errors.append(f"{cid}: {msg}")
            except Exception as e:
                skipped_errors.append(f"{cid}: {e}")

        # Sort: MCC first, then by name
        accounts_meta.sort(key=lambda a: (not a["manager"], a["name"].lower()))

        elapsed = time.perf_counter() - t0
        err = None
        if warning:
            err = warning
        if skipped_errors:
            skipped_text = "Some accounts were skipped:\n" + "\n".join(skipped_errors[:5])
            if len(skipped_errors) > 5:
                skipped_text += f"\n...and {len(skipped_errors) - 5} more."
            err = (err + "\n\n" if err else "") + skipped_text
        if err:
            err += f"\n\n(Accounts loaded in {elapsed:.2f}s)"

        return render_template_string(ACCOUNTS_HTML, accounts=accounts_meta, error=err)
    except GoogleAdsException as e:
        failure = getattr(e, "failure", None)
        if failure and getattr(failure, "errors", None):
            msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
        else:
            msg = str(e)
        return render_template_string(
            ACCOUNTS_HTML,
            accounts=[],
            error=f"GoogleAdsException: {msg}",
        )
    except Exception as e:
        return render_template_string(ACCOUNTS_HTML, accounts=[], error=str(e))

@app.get("/report")
def report_page():
    refresh_token = session.get("refresh_token", "")
    if not refresh_token:
        return redirect(url_for("accounts"))
    customer_id = request.args.get("customer_id", "").strip()
    if not customer_id:
        return redirect(url_for("accounts"))
    return render_template_string(REPORT_HTML, customer_id=customer_id)

@app.get("/api/report")
def api_report():
    refresh_token = session.get("refresh_token", "")
    if not refresh_token:
        return jsonify({"error": "No refresh_token in session. Please login again."}), 401

    customer_id = request.args.get("customer_id", "").strip()
    if not customer_id:
        return jsonify({"error": "Missing customer_id"}), 400

    t0 = time.perf_counter()
    days_raw = request.args.get("days", "7").strip()
    try:
        days = int(days_raw)
    except ValueError:
        return jsonify({"error": "Invalid days value (must be an integer)."}), 400
    if days < 1 or days > 730:
        return jsonify({"error": "Days must be between 1 and 730."}), 400
    try:
        # Default client (no login_customer_id)
        client = build_googleads_client(refresh_token)
        selected = fetch_customer_meta(client, customer_id)

        if selected["manager"]:
            # MCC path
            manager_id = selected["id"]
            manager_name = selected["name"]

            # Find leaf accounts recursively under this manager
            leaves = list_leaf_accounts_under_manager(refresh_token, manager_id)

            # For spend queries on child accounts, set login_customer_id = manager
            mcc_client = build_googleads_client(refresh_token, login_customer_id=manager_id)

            children_reports = []
            for acc in leaves:
                daily = fetch_daily_spend(mcc_client, acc["id"], last_n_days=days)
                total = sum(r["cost"] for r in daily)
                total_impr = sum(r.get("impressions", 0) for r in daily)
                total_clicks = sum(r.get("clicks", 0) for r in daily)
                total_conv = sum(r.get("conversions", 0) for r in daily)
                children_reports.append({
                    "id": acc["id"],
                    "name": acc["name"],
                    "currency_code": acc["currency_code"],
                    "daily_rows": daily,
                    "total_cost": float(total),
                    "total_impressions": int(total_impr),
                    "total_clicks": int(total_clicks),
                    "total_conversions": float(total_conv),
                })

            # Sort by total desc
            children_reports.sort(key=lambda x: x["total_cost"], reverse=True)

            elapsed = time.perf_counter() - t0
            return jsonify({
                "kind": "mcc",
                "elapsed_seconds": float(elapsed),
                "days": days,
                "manager": {"id": manager_id, "name": manager_name},
                "children": children_reports,
            })

        else:
            # Single account path: last N days
            daily = fetch_daily_spend(client, customer_id, last_n_days=days)
            elapsed = time.perf_counter() - t0
            return jsonify({
                "kind": "single",
                "elapsed_seconds": float(elapsed),
                "days": days,
                "account": {
                    "id": selected["id"],
                    "name": selected["name"],
                    "currency_code": selected["currency_code"],
                },
                "daily_rows": daily,
            })

    except GoogleAdsException as e:
        elapsed = time.perf_counter() - t0
        failure = getattr(e, "failure", None)
        if failure and getattr(failure, "errors", None):
            msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
        else:
            msg = str(e)
        return jsonify({"error": f"GoogleAdsException: {msg}", "elapsed_seconds": float(elapsed)}), 500
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return jsonify({"error": str(e), "elapsed_seconds": float(elapsed)}), 500

@app.get("/api/campaigns")
def api_campaigns():
    refresh_token = session.get("refresh_token", "")
    if not refresh_token:
        return jsonify({"error": "No refresh_token in session. Please login again."}), 401

    customer_id = request.args.get("customer_id", "").strip()
    if not customer_id:
        return jsonify({"error": "Missing customer_id"}), 400

    days_raw = request.args.get("days", "7").strip()
    try:
        days = int(days_raw)
    except ValueError:
        return jsonify({"error": "Invalid days value (must be an integer)."}), 400
    if days < 1 or days > 730:
        return jsonify({"error": "Days must be between 1 and 730."}), 400

    t0 = time.perf_counter()
    try:
        client = build_googleads_client(refresh_token)
        selected = fetch_customer_meta(client, customer_id)
        if selected["manager"]:
            return jsonify({"error": "Campaign breakdown is not supported for MCC accounts. Select a leaf account."}), 400

        campaigns = fetch_campaigns(client, customer_id, last_n_days=days)
        elapsed = time.perf_counter() - t0
        return jsonify({
            "kind": "campaign",
            "elapsed_seconds": float(elapsed),
            "days": days,
            "account": {
                "id": selected["id"],
                "name": selected["name"],
                "currency_code": selected["currency_code"],
            },
            "campaigns": campaigns,
        })
    except GoogleAdsException as e:
        elapsed = time.perf_counter() - t0
        failure = getattr(e, "failure", None)
        if failure and getattr(failure, "errors", None):
            msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
        else:
            msg = str(e)
        return jsonify({"error": f"GoogleAdsException: {msg}", "elapsed_seconds": float(elapsed)}), 500
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return jsonify({"error": str(e), "elapsed_seconds": float(elapsed)}), 500

@app.get("/api/ad-groups")
def api_ad_groups():
    refresh_token = session.get("refresh_token", "")
    if not refresh_token:
        return jsonify({"error": "No refresh_token in session. Please login again."}), 401

    customer_id = request.args.get("customer_id", "").strip()
    campaign_id = request.args.get("campaign_id", "").strip()
    if not customer_id:
        return jsonify({"error": "Missing customer_id"}), 400
    if not campaign_id:
        return jsonify({"error": "Missing campaign_id"}), 400
    try:
        campaign_id = require_numeric(campaign_id, "campaign_id")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    days_raw = request.args.get("days", "7").strip()
    try:
        days = int(days_raw)
    except ValueError:
        return jsonify({"error": "Invalid days value (must be an integer)."}), 400
    if days < 1 or days > 730:
        return jsonify({"error": "Days must be between 1 and 730."}), 400

    t0 = time.perf_counter()
    try:
        client = build_googleads_client(refresh_token)
        ad_groups = fetch_ad_groups(client, customer_id, campaign_id=campaign_id, last_n_days=days)
        meta = fetch_customer_meta(client, customer_id)
        elapsed = time.perf_counter() - t0
        return jsonify({
            "elapsed_seconds": float(elapsed),
            "days": days,
            "ad_groups": ad_groups,
            "currency_code": meta["currency_code"],
        })
    except GoogleAdsException as e:
        elapsed = time.perf_counter() - t0
        failure = getattr(e, "failure", None)
        if failure and getattr(failure, "errors", None):
            msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
        else:
            msg = str(e)
        return jsonify({"error": f"GoogleAdsException: {msg}", "elapsed_seconds": float(elapsed)}), 500
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return jsonify({"error": str(e), "elapsed_seconds": float(elapsed)}), 500

@app.get("/api/ads")
def api_ads():
    refresh_token = session.get("refresh_token", "")
    if not refresh_token:
        return jsonify({"error": "No refresh_token in session. Please login again."}), 401

    customer_id = request.args.get("customer_id", "").strip()
    ad_group_id = request.args.get("ad_group_id", "").strip()
    if not customer_id:
        return jsonify({"error": "Missing customer_id"}), 400
    if not ad_group_id:
        return jsonify({"error": "Missing ad_group_id"}), 400
    try:
        ad_group_id = require_numeric(ad_group_id, "ad_group_id")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    days_raw = request.args.get("days", "7").strip()
    try:
        days = int(days_raw)
    except ValueError:
        return jsonify({"error": "Invalid days value (must be an integer)."}), 400
    if days < 1 or days > 730:
        return jsonify({"error": "Days must be between 1 and 730."}), 400

    t0 = time.perf_counter()
    try:
        client = build_googleads_client(refresh_token)
        ads = fetch_ads(client, customer_id, ad_group_id=ad_group_id, last_n_days=days)
        elapsed = time.perf_counter() - t0
        return jsonify({
            "elapsed_seconds": float(elapsed),
            "days": days,
            "ads": ads,
        })
    except GoogleAdsException as e:
        elapsed = time.perf_counter() - t0
        failure = getattr(e, "failure", None)
        if failure and getattr(failure, "errors", None):
            msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
        else:
            msg = str(e)
        return jsonify({"error": f"GoogleAdsException: {msg}", "elapsed_seconds": float(elapsed)}), 500
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return jsonify({"error": str(e), "elapsed_seconds": float(elapsed)}), 500

@app.get("/api/keywords")
def api_keywords():
    refresh_token = session.get("refresh_token", "")
    if not refresh_token:
        return jsonify({"error": "No refresh_token in session. Please login again."}), 401

    customer_id = request.args.get("customer_id", "").strip()
    ad_group_id = request.args.get("ad_group_id", "").strip()
    if not customer_id:
        return jsonify({"error": "Missing customer_id"}), 400
    if not ad_group_id:
        return jsonify({"error": "Missing ad_group_id"}), 400
    try:
        ad_group_id = require_numeric(ad_group_id, "ad_group_id")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    days_raw = request.args.get("days", "7").strip()
    try:
        days = int(days_raw)
    except ValueError:
        return jsonify({"error": "Invalid days value (must be an integer)."}), 400
    if days < 1 or days > 730:
        return jsonify({"error": "Days must be between 1 and 730."}), 400

    t0 = time.perf_counter()
    try:
        client = build_googleads_client(refresh_token)
        keywords = fetch_keywords(client, customer_id, ad_group_id=ad_group_id, last_n_days=days)
        elapsed = time.perf_counter() - t0
        return jsonify({
            "elapsed_seconds": float(elapsed),
            "days": days,
            "keywords": keywords,
        })
    except GoogleAdsException as e:
        elapsed = time.perf_counter() - t0
        failure = getattr(e, "failure", None)
        if failure and getattr(failure, "errors", None):
            msg = "; ".join(err.message for err in failure.errors if getattr(err, "message", None))
        else:
            msg = str(e)
        return jsonify({"error": f"GoogleAdsException: {msg}", "elapsed_seconds": float(elapsed)}), 500
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return jsonify({"error": str(e), "elapsed_seconds": float(elapsed)}), 500


if __name__ == "__main__":
    app.run(host="localhost", port=8000, debug=True)

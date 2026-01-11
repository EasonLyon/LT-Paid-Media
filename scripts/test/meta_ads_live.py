import os
import secrets
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv
from flask import Flask, redirect, request, session, url_for, render_template_string, jsonify

load_dotenv()

def require_env(key: str) -> str:
    v = os.getenv(key, "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {key}")
    return v

META_APP_ID = require_env("META_APP_ID")
META_APP_SECRET = require_env("META_APP_SECRET")
META_REDIRECT_URI = require_env("META_REDIRECT_URI")

META_SCOPES = os.getenv(
    "META_SCOPES",
    "ads_management,ads_read,business_management,email,pages_manage_ads,pages_read_engagement",
).strip()
META_GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v24.0").strip()

GRAPH_BASE = f"https://graph.facebook.com/{META_GRAPH_VERSION}"

app = Flask(__name__)
app.secret_key = require_env("FLASK_SECRET_KEY")


INDEX_HTML = """
<h2>Meta Ads OAuth Demo (Login → List Ad Accounts)</h2>
<p>
  This demo uses the Meta manual OAuth flow (code → token), exchanges to a long-lived token,
  then calls <code>/me/adaccounts</code>.
</p>

{% if token %}
  <p><b>Status:</b> Logged in ✅</p>
  <ul>
    <li><a href="{{ url_for('show_adaccounts') }}">View Ad Accounts</a></li>
    <li><a href="{{ url_for('debug_token') }}">Debug Token (JSON)</a></li>
    <li><a href="{{ url_for('logout') }}">Logout</a></li>
  </ul>
  {% if token_type == "long_lived" %}
    <details style="margin-top: 12px;">
      <summary><b>Long-Lived Access Token (debug)</b></summary>
      <p><small>Expires in: {{ expires_in_sec }} seconds</small></p>
      <pre style="white-space: pre-wrap; word-break: break-all;">{{ token }}</pre>
    </details>
  {% endif %}
{% else %}
  <p><b>Status:</b> Not logged in ❌</p>
  <a href="{{ login_url }}"><button style="padding:10px 14px;">Continue with Meta</button></a>
{% endif %}

<hr/>
<p><small>
Make sure META_REDIRECT_URI is registered in Meta Developer Console → Facebook Login → Settings → Valid OAuth Redirect URIs.
</small></p>
"""

ACCOUNTS_HTML = """
<h2>Ad Accounts</h2>
<p><a href="{{ url_for('index') }}">← Back</a> | <a href="{{ url_for('logout') }}">Logout</a></p>

{% if error %}
  <h3 style="color:#b00020;">Error</h3>
  <pre>{{ error }}</pre>
{% endif %}

{% if accounts %}
  <table border="1" cellpadding="8" cellspacing="0">
    <tr>
      <th>ID</th>
      <th>Name</th>
      <th>Account Status</th>
      <th>Currency</th>
      <th>Timezone</th>
    </tr>
    {% for a in accounts %}
      <tr>
        <td>{{ a.get('id') }}</td>
        <td>{{ a.get('name') }}</td>
        <td>{{ a.get('account_status') }}</td>
        <td>{{ a.get('currency') }}</td>
        <td>{{ a.get('timezone_name') }}</td>
      </tr>
    {% endfor %}
  </table>
{% else %}
  <p>No ad accounts returned.</p>
{% endif %}

<hr/>
<h3>Raw JSON (first page)</h3>
<pre>{{ raw_json }}</pre>
"""

def build_login_url() -> str:
    # State is CSRF protection
    state = secrets.token_urlsafe(24)
    session["oauth_state"] = state

    params = {
        "client_id": META_APP_ID,
        "redirect_uri": META_REDIRECT_URI,
        "state": state,
        "scope": META_SCOPES,
        "response_type": "code",
    }
    return f"https://www.facebook.com/{META_GRAPH_VERSION}/dialog/oauth?{urlencode(params)}"

def exchange_code_for_short_lived_token(code: str) -> dict:
    # GET /oauth/access_token?client_id&redirect_uri&client_secret&code
    url = f"{GRAPH_BASE}/oauth/access_token"
    params = {
        "client_id": META_APP_ID,
        "client_secret": META_APP_SECRET,
        "redirect_uri": META_REDIRECT_URI,
        "code": code,
    }
    r = requests.get(url, params=params, timeout=30)
    return {"ok": r.ok, "status": r.status_code, "json": r.json()}

def exchange_for_long_lived_token(short_lived_token: str) -> dict:
    # GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=...
    url = f"{GRAPH_BASE}/oauth/access_token"
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": META_APP_ID,
        "client_secret": META_APP_SECRET,
        "fb_exchange_token": short_lived_token,
    }
    r = requests.get(url, params=params, timeout=30)
    return {"ok": r.ok, "status": r.status_code, "json": r.json()}

def graph_get(path: str, access_token: str, params: dict | None = None) -> dict:
    if params is None:
        params = {}
    url = f"{GRAPH_BASE}{path}"
    params = {**params, "access_token": access_token}
    r = requests.get(url, params=params, timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {"error": {"message": "Non-JSON response", "raw": r.text[:2000]}}
    return {"ok": r.ok, "status": r.status_code, "json": data}

def fetch_all_adaccounts(access_token: str) -> tuple[list[dict], dict]:
    """
    Fetch /me/adaccounts with basic pagination support.
    Returns (accounts, first_page_json)
    """
    fields = "id,name,account_status,currency,timezone_name"
    first = graph_get("/me/adaccounts", access_token, params={"fields": fields, "limit": "50"})
    if not first["ok"]:
        return [], first["json"]

    accounts = list(first["json"].get("data", []))
    paging = first["json"].get("paging", {})
    next_url = paging.get("next")

    # Print first page for visibility
    print("First page /me/adaccounts:", first["json"])

    # Follow "next" links (Graph API pagination)
    while next_url:
        r = requests.get(next_url, timeout=30)
        page = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"error": r.text}
        accounts.extend(page.get("data", []))
        next_url = page.get("paging", {}).get("next")

    return accounts, first["json"]

@app.route("/")
def index():
    token = session.get("meta_access_token")
    return render_template_string(
        INDEX_HTML,
        token=token,
        token_type=session.get("meta_token_type"),
        expires_in_sec=session.get("meta_expires_in_sec"),
        login_url=build_login_url(),
    )

@app.route("/callback")
def callback():
    # Handle errors from Meta
    if request.args.get("error"):
        return jsonify({
            "error": request.args.get("error"),
            "error_reason": request.args.get("error_reason"),
            "error_description": request.args.get("error_description"),
        }), 400

    code = request.args.get("code", "")
    state = request.args.get("state", "")

    expected_state = session.get("oauth_state")
    if not expected_state or state != expected_state:
        return jsonify({"error": "Invalid state (CSRF check failed)"}), 400

    if not code:
        return jsonify({"error": "Missing code"}), 400

    # 1) code -> short-lived token
    short = exchange_code_for_short_lived_token(code)
    if not short["ok"]:
        return jsonify({"step": "code->short_lived", **short}), 400

    short_token = short["json"].get("access_token")
    if not short_token:
        return jsonify({"error": "No access_token in response", "raw": short}), 400

    # 2) short-lived -> long-lived token
    long_ = exchange_for_long_lived_token(short_token)
    if not long_["ok"]:
        # Still store short token so you can debug / continue
        session["meta_access_token"] = short_token
        session["meta_token_type"] = "short_lived"
        return jsonify({"step": "short->long_lived", **long_}), 400

    long_token = long_["json"].get("access_token")
    expires_in = long_["json"].get("expires_in")

    session["meta_access_token"] = long_token
    session["meta_token_type"] = "long_lived"
    session["meta_expires_in_sec"] = expires_in

    print("✅ Logged in. Token type=long_lived, expires_in=", expires_in)

    return redirect(url_for("show_adaccounts"))

@app.route("/adaccounts")
def show_adaccounts():
    token = session.get("meta_access_token")
    if not token:
        return redirect(url_for("index"))

    accounts, first_page_json = fetch_all_adaccounts(token)

    error = None
    # If first page contains error
    if isinstance(first_page_json, dict) and first_page_json.get("error"):
        error = first_page_json

    return render_template_string(
        ACCOUNTS_HTML,
        accounts=accounts,
        raw_json=first_page_json,
        error=error
    )

@app.route("/debug-token")
def debug_token():
    token = session.get("meta_access_token")
    if not token:
        return jsonify({"logged_in": False})

    return jsonify({
        "logged_in": True,
        "token_type": session.get("meta_token_type"),
        "expires_in_sec": session.get("meta_expires_in_sec"),
        "access_token": token,
        "token_preview": token[:12] + "..." + token[-8:],  # don't dump full token
        "scopes_requested": META_SCOPES,
        "graph_version": META_GRAPH_VERSION,
    })

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))

if __name__ == "__main__":
    # Runs on http://localhost:8000
    app.run(host="0.0.0.0", port=8000, debug=True)

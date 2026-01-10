import requests
import time

API_VERSION = "v24.0"
TOKEN = "EAARDJQawBUMBQbJTDz6sBVLRFt4BrZCg117lcLrJQyNdwP9TBgsk5JJdkP01XdLFqQKwOoL6ZBPmPp3Uw3lReocCKOjrpD1M5ZCtTbR3V5DKjZBgjG2dcFHvN6ZAYOCIni346Bgv8RQRwuFZB6n4C5PaZAUk3vy8REnka4IpD1Xl6AAq0mNZCY15aiSqiAi1VZAG4XZAGo1QF4ipZByQXI1ylADAYu8Sfcx5BmwI7ZANblZChHeTnsT5YEs7K5lro9doo0r8DntceCgpvL8meBKsZD"
BASE = f"https://graph.facebook.com/{API_VERSION}"

def fb_get_json(url: str, params: dict, *, max_retries: int = 2):
    """
    Returns (json, None) on success
    Returns (None, error_dict) on Meta error
    Retries on transient HTTP errors
    """
    for attempt in range(max_retries + 1):
        r = requests.get(url, params=params, timeout=60)

        if r.status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
            time.sleep(2 ** attempt)
            continue

        try:
            j = r.json()
        except Exception:
            r.raise_for_status()
            raise RuntimeError("Non-JSON response from Meta API")

        if "error" in j:
            return None, j["error"]

        return j, None

    return None, {"message": "Exceeded retries", "type": "LocalError", "code": -1}


def get_all_pages(first_url: str, first_params: dict):
    """
    Follows Meta cursor pagination using paging.next
    """
    out = []
    url = first_url
    params = first_params

    while True:
        data, err = fb_get_json(url, params)
        if err:
            raise RuntimeError(f"Failed paging call: {err}")

        out.extend(data.get("data", []))
        next_url = (data.get("paging") or {}).get("next")
        if not next_url:
            break

        url, params = next_url, None  # next already contains query params
    return out


def list_accessible_ad_accounts():
    """
    Lists only ad accounts accessible by THIS token.
    """
    url = f"{BASE}/me/adaccounts"
    params = {
        "fields": "id,name",  # keep minimal; we won't print id
        "limit": 200,
        "access_token": TOKEN
    }
    return get_all_pages(url, params)


def get_yesterday_spend(act_id: str):
    """
    Returns spend (float) for yesterday for a single ad account.
    """
    url = f"{BASE}/{act_id}/insights"
    params = {
        "fields": "account_name,spend",
        "level": "account",
        "date_preset": "yesterday",
        "limit": 1,
        "access_token": TOKEN
    }
    data, err = fb_get_json(url, params)
    if err:
        return None, err

    rows = data.get("data", [])
    if not rows:
        return 0.0, None  # no delivery yesterday
    spend_str = rows[0].get("spend") or "0"
    return float(spend_str), None


def friendly_reason(err: dict) -> str:
    code = err.get("code")
    msg = (err.get("message") or "").lower()

    if code == 200 and ("ads_read" in msg or "ads_management" in msg or "permission" in msg):
        return "Missing ads_read/ads_management OR not granted access to this ad account."
    if code == 190:
        return "Invalid/expired access token (OAuth 190)."
    if code in (4, 17, 32) or "rate" in msg:
        return "Rate limited / throttled."
    return err.get("message") or "Unknown error"


def main():
    # 1) Get accounts that the token can access
    accounts = list_accessible_ad_accounts()
    print(f"Found {len(accounts)} accessible ad account(s) from token.")

    # 2) Pull yesterday spend for each
    for a in accounts:
        name = a.get("name") or "(no name)"
        act_id = a.get("id")  # required for API calls; don't print it

        spend, err = get_yesterday_spend(act_id)
        if err:
            print(f"[SKIP] {name} -> {friendly_reason(err)}")
            continue

        print(f"[OK]   {name} -> yesterday_spend={spend:.2f}")


if __name__ == "__main__":
    main()

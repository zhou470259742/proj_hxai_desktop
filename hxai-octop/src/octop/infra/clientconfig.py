"""Client-config pull consumer for server-connected deployments (HX).

In server mode the instance periodically mirrors ``GET {server_url}/v1/client-config``
into settings. Reads are lazy-refreshing: callers get the stored copy and a
refresh is attempted when it is older than ``TTL_SECONDS``. Pairing/auth uses
an optional instance client token (settings ``client_token``); without one the
pull still works when the server allows anonymous manifests.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import httpx

from octop.infra.deployment import server_url

logger = logging.getLogger(__name__)

SETTING_CLIENT_CONFIG = "client_config_json"
SETTING_CLIENT_CONFIG_AT = "client_config_fetched_at"
SETTING_CLIENT_TOKEN = "client_token"

TTL_SECONDS = 60


def _repo(server: Any) -> Any:
    services = getattr(server, "services", None)
    if services is None:
        services = server
    return getattr(services, "settings_repo", None)


async def _http_get(url: str, token: str | None) -> dict[str, Any] | None:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            return None
        body = resp.json()
        return body if isinstance(body, dict) else None


def client_config(server: Any) -> dict[str, Any] | None:
    """Return the last fetched client config, or None when never fetched."""
    repo = _repo(server)
    if repo is None:
        return None
    raw = repo.get(SETTING_CLIENT_CONFIG)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _is_stale(repo: Any) -> bool:
    raw = repo.get(SETTING_CLIENT_CONFIG_AT) or "0"
    try:
        fetched_at = float(raw)
    except ValueError:
        fetched_at = 0.0
    return (time.time() - fetched_at) >= TTL_SECONDS


async def fetch_client_config(server: Any, *, force: bool = False) -> dict[str, Any] | None:
    """Best-effort pull of the server-side client config into settings.

    Returns the stored config (fresh or previously cached); ``None`` when no
    server is configured or the fetch failed and nothing was cached.
    """
    repo = _repo(server)
    if repo is None:
        return None
    if not force and not _is_stale(repo):
        return client_config(server)
    base = server_url(server)
    if not base:
        return client_config(server)
    token = (repo.get(SETTING_CLIENT_TOKEN) or "").strip() or None
    try:
        body = await _http_get(f"{base}/v1/client-config", token)
    except Exception as exc:
        logger.warning("client-config pull failed: %s", exc)
        return client_config(server)
    if body is None:
        return client_config(server)
    repo.set(SETTING_CLIENT_CONFIG, json.dumps(body, ensure_ascii=False))
    repo.set(SETTING_CLIENT_CONFIG_AT, str(time.time()))

    # 技能市场换源：market.skillsetOrigin/skillMarketOrigin → env 覆盖
    # （skillhub_common.*_origin 直接读 env；值缺省时移除还原官方默认）。
    market = body.get("market") if isinstance(body.get("market"), dict) else {}
    for key, env in (
        ("skillsetOrigin", "SKILLSET_ORIGIN"),
        ("skillMarketOrigin", "SKILL_MARKET_ORIGIN"),
    ):
        val = str(market.get(key) or "").strip()
        if val:
            os.environ[env] = val
        else:
            os.environ.pop(env, None)

    # 连接器目录上报：admin 勾选界面靠它渲染（失败静默，不阻塞配置刷新）
    try:
        from octop.infra.connectors.catalog import list_catalog  # noqa: PLC0415

        cat = [
            {"id": e.kind, "name": getattr(e.name, "zh", None) or getattr(e.name, "en", str(e.kind))}
            for e in list_catalog()
        ]
        await _http_post(f"{base}/v1/connectors/catalog", token, {"items": cat})
    except Exception:
        pass
    return body


SETTING_USER_STATUS_AT = "user_status_fetched_at"


async def fetch_user_status(server: Any) -> list[dict[str, Any]] | None:
    """Pull ``{server_url}/v1/users/status`` — the server-side user status list.

    Returns the ``items`` list on success, ``None`` otherwise. No caching: the
    caller applies the result immediately (disable propagation).
    """
    repo = _repo(server)
    base = server_url(server)
    if repo is None or not base:
        return None
    token = (repo.get(SETTING_CLIENT_TOKEN) or "").strip() or None
    try:
        body = await _http_get(f"{base}/v1/users/status", token)
    except Exception as exc:
        logger.warning("users-status pull failed: %s", exc)
        return None
    if body is None:
        return None
    items = body.get("items")
    return items if isinstance(items, list) else None


async def _http_post(url: str, token: str | None, payload: dict) -> bool:
    import httpx

    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            r = await client.post(url, json=payload, headers=headers)
        return r.status_code < 300
    except Exception as exc:  # noqa: BLE001
        logger.warning("push to %s failed: %s", url, exc)
        return False


async def push_user_password(services: Any, subject: str, password: str) -> bool:
    """Server-mode upward sync: a local password change must propagate to the
    control plane (identity authority). Best-effort; caller audits the result.
    """
    repo = _repo(services)
    base = server_url(services)
    if repo is None or not base:
        return False
    token = (repo.get(SETTING_CLIENT_TOKEN) or "").strip() or None
    return await _http_post(
        f"{base}/v1/users/password", token, {"subject": subject, "password": password}
    )


async def push_user(
    services: Any, username: str, display_name: str = "", password: str = ""
) -> bool:
    """Push a locally-registered user up to the control plane (upsert).

    No-op when unconfigured — the bundled admin in standalone mode is
    reached the same way (server_url points at it).
    """
    repo = _repo(services)
    base = server_url(services)
    if repo is None or not base:
        return False
    token = (repo.get(SETTING_CLIENT_TOKEN) or "").strip() or None
    if not token:
        return False
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            r = await client.post(
                f"{base}/v1/users",
                json={
                    "username": username,
                    "display_name": display_name or username,
                    "password": password,
                },
                headers={
                    "content-type": "application/json",
                    "authorization": f"Bearer {token}",
                },
            )
        if r.status_code != 200:
            logger.warning("push_user %s failed: %s %s", username, r.status_code, r.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("push_user %s failed: %s", username, exc)
        return False


async def verify_user_password(
    services: Any, username: str, password: str
) -> dict[str, Any] | None:
    """Server-mode proxy login: forward username+password to the control plane
    for verification. Returns JIT claims on success, None otherwise.
    """
    repo = _repo(services)
    base = server_url(services)
    if repo is None or not base:
        return None
    token = (repo.get(SETTING_CLIENT_TOKEN) or "").strip() or None
    import httpx

    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            r = await client.post(
                f"{base}/v1/auth/verify",
                json={"username": username, "password": password},
                headers=headers,
            )
        if r.status_code != 200:
            return None
        data = r.json()
        return data.get("claims") if data.get("ok") else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("central auth verify failed: %s", exc)
        return None

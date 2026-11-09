"""Deployment mode: standalone vs server-connected (HX).

Priority for the server URL: explicit setting > ``OCTOP_ADMIN_ORIGIN`` env.
With no URL anywhere the instance runs standalone. ``deployment_mode`` in
settings wins over the env heuristic once an admin has chosen explicitly.
"""

from __future__ import annotations

import os
from typing import Any

from octop.infra.errors import ErrorCode, OctopError

MODE_STANDALONE = "standalone"
MODE_SERVER = "server"

SETTING_DEPLOYMENT_MODE = "deployment_mode"
SETTING_SERVER_URL = "server_url"


def env_server_url() -> str:
    return os.environ.get("OCTOP_ADMIN_ORIGIN", "").strip().rstrip("/")


def _repo(server: Any) -> Any:
    """Accept either the OctopServer or its SharedServices bundle."""
    services = getattr(server, "services", None)
    if services is None:
        services = server
    return getattr(services, "settings_repo", None)


def deployment_mode(server: Any) -> str:
    repo = _repo(server)
    raw = (repo.get(SETTING_DEPLOYMENT_MODE) or "").strip() if repo is not None else ""
    if raw in (MODE_STANDALONE, MODE_SERVER):
        return raw
    return MODE_SERVER if env_server_url() else MODE_STANDALONE


def is_server_mode(server: Any) -> bool:
    return deployment_mode(server) == MODE_SERVER


def server_url(server: Any) -> str:
    repo = _repo(server)
    raw = (repo.get(SETTING_SERVER_URL) or "").strip().rstrip("/") if repo is not None else ""
    return raw or env_server_url()


def set_deployment(server: Any, *, mode: str, url: str | None = None) -> None:
    repo = _repo(server)
    if repo is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "settings store unavailable")
    if mode not in (MODE_STANDALONE, MODE_SERVER):
        raise OctopError(ErrorCode.DEPLOYMENT_INVALID, f"unknown deployment mode {mode!r}")
    repo.set(SETTING_DEPLOYMENT_MODE, mode)
    if url is not None:
        repo.set(SETTING_SERVER_URL, url.strip().rstrip("/"))


def require_local_registration(server: Any) -> None:
    """Reject local-account creation while the instance runs in server mode."""
    if is_server_mode(server):
        raise OctopError(
            ErrorCode.FORBIDDEN,
            "server mode: local registration is disabled",
        )

"""Deployment mode settings: standalone vs server-connected (HX)."""

from __future__ import annotations

import ipaddress
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from octop.api.deps import current_user, get_server, require_admin
from octop.infra import clientconfig, deployment
from octop.infra.errors import ErrorCode, OctopError

router = APIRouter()


def _payload(server: Any) -> dict[str, Any]:
    stored = (
        (server.services.settings_repo.get(deployment.SETTING_DEPLOYMENT_MODE) or "").strip()
        if server.services is not None and server.services.settings_repo is not None
        else ""
    )
    source = (
        "setting"
        if stored in (deployment.MODE_STANDALONE, deployment.MODE_SERVER)
        else "env" if deployment.env_server_url() else "default"
    )
    return {
        "mode": deployment.deployment_mode(server),
        "server_url": deployment.server_url(server),
        "env_server_url": deployment.env_server_url(),
        "mode_source": source,
        "client_config": clientconfig.client_config(server),
        "client_token_set": bool(
            server.services is not None
            and server.services.settings_repo is not None
            and (server.services.settings_repo.get(clientconfig.SETTING_CLIENT_TOKEN) or "").strip()
        ),
    }


@router.get("/deployment", summary="Deployment mode and server address")
async def get_deployment(
    _: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return _payload(server)


class DeploymentBody(BaseModel):
    mode: Literal["standalone", "server"] | None = None
    server_url: str | None = None
    client_token: str | None = None


@router.get("/deployment/status", summary="Public deployment mode (login page)")
async def deployment_status(
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Pre-auth variant for the login page: mode + server address.

    ``server_url`` is disclosed during the SSO redirect anyway, so exposing
    it here adds no new surface; the login page needs it for reachability
    probing.
    """
    cfg = clientconfig.client_config(server) or {}
    product = (cfg.get("brandProductName") or "").strip() or "HX 智能体"
    return {
        "mode": deployment.deployment_mode(server),
        "server_url": deployment.server_url(server),
        "product_name": product,
    }


class ModeBody(BaseModel):
    mode: Literal["standalone", "server"]


@router.put("/deployment/mode", summary="Switch deployment mode (loopback only)")
async def put_deployment_mode(body: ModeBody, request: Request, server: Any = Depends(get_server)) -> dict[str, Any]:
    """Pre-auth mode switch for the login-page toggle. Restricted to loopback —
    same trust model as the local CLI trusting filesystem access."""
    host = (request.client.host if request.client else "") or ""
    try:
        loopback = ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        loopback = host == "localhost"
    if not loopback:
        raise OctopError(ErrorCode.DEPLOYMENT_INVALID, "mode switch requires local access")
    deployment.set_deployment(server, mode=body.mode)
    if body.mode == deployment.MODE_SERVER:
        await clientconfig.fetch_client_config(server, force=True)
    return {"mode": deployment.deployment_mode(server), "server_url": deployment.server_url(server)}


@router.put("/deployment", summary="Set deployment mode / server address")
async def put_deployment(
    body: DeploymentBody,
    _: Any = Depends(require_admin()),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    if body.mode is None and body.server_url is None and body.client_token is None:
        raise OctopError(ErrorCode.DEPLOYMENT_INVALID, "nothing to update")
    if body.mode is not None:
        deployment.set_deployment(server, mode=body.mode)
    if body.server_url is not None:
        url = body.server_url.strip()
        if url and not url.startswith(("http://", "https://")):
            raise OctopError(ErrorCode.DEPLOYMENT_INVALID, "server_url must be http(s)")
        deployment.set_deployment(
            server, mode=deployment.deployment_mode(server), url=url
        )
    if body.client_token is not None:
        repo = server.services.settings_repo
        token = body.client_token.strip()
        # Empty string clears the token (unpair); non-empty stores verbatim.
        repo.set(clientconfig.SETTING_CLIENT_TOKEN, token)
    if deployment.deployment_mode(server) == deployment.MODE_SERVER:
        await clientconfig.fetch_client_config(server, force=True)
    return _payload(server)


@router.get("/deployment/external-apps", summary="External app entries delivered by the workbench")
async def external_apps(server: Any = Depends(get_server)) -> dict[str, Any]:
    """Enabled agentLinks from the pulled client-config — sidebar launcher."""
    # 打开应用页才触发，低频——直接强拉最新下发配置。
    await clientconfig.fetch_client_config(server, force=True)
    cfg = clientconfig.client_config(server) or {}
    items = []
    for a in cfg.get("agentLinks") or []:
        if not isinstance(a, dict) or a.get("enabled") is False:
            continue
        items.append(
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "url": a.get("url"),
                "desc": a.get("desc") or "",
                "icon": a.get("icon") or "",
                "color": a.get("color") or "",
                "openMode": "external" if a.get("openMode") == "external" else "iframe",
            }
        )
    return {"items": items}

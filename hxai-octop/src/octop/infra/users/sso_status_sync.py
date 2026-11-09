"""Server → instance disabled-user propagation (HX).

In server mode the control plane is authoritative for user lifecycle: when it
disables a user, the instance disables the matching sso-bound local account
(data is kept — only login is blocked). Matching is by the SSO provider whose
issuer equals ``server_url``; ``sub`` = server-side user id.
"""

from __future__ import annotations

import logging
from typing import Any

from octop.infra import clientconfig, deployment

logger = logging.getLogger(__name__)


def _provider_for_server(services: Any) -> int | None:
    base = deployment.server_url(services)
    if not base:
        return None
    for p in services.sso_repo.list():
        if (p.issuer or "").rstrip("/") == base:
            return int(p.id)
    return None


async def sync_disabled_users(services: Any) -> int:
    """Disable sso-bound local users whose server-side status is disabled.

    Returns the number of accounts disabled this pass. Best-effort: pull or
    provider mismatch just yields 0.
    """
    if not deployment.is_server_mode(services):
        return 0
    provider_id = _provider_for_server(services)
    if provider_id is None:
        return 0
    items = await clientconfig.fetch_user_status(services)
    if not items:
        return 0
    disabled_subjects = {
        str(i.get("id", "")).strip()
        for i in items
        if isinstance(i, dict) and i.get("status") == "disabled"
    }
    disabled_subjects.discard("")
    count = 0
    for subject in disabled_subjects:
        row = services.user_repo.get_by_sso(provider_id, subject)
        if row is None or row.disabled:
            continue
        services.user_repo.set_disabled(row.id, True)
        services.audit_repo.write(
            actor="_system",
            action="user.sso_disabled_sync",
            target=row.username,
            payload=f"provider={provider_id} sub={subject}",
        )
        count += 1
    return count

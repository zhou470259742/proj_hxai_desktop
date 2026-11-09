"""claim→role mapping for server-connected deployments (HX).

The control plane ships ``extra.ssoRoleMapping`` inside client-config:

    "ssoRoleMapping": [
        {"claim": "department", "values": ["法务部", "legal"], "role": "legal-staff"}
    ]

First matching rule wins; ``role`` references an instance-side user-role
template id (its permissions/policies apply). Only consulted in server mode —
standalone instances always fall back to the seeded user role.
"""

from __future__ import annotations

import builtins
from typing import Any

from octop.infra import clientconfig, deployment
from octop.infra.db.repos.user_roles import (
    role_assignment_for,
    seeded_user_role_assignment,
)

RoleAssignment = tuple[str, str | None, builtins.list[str], builtins.list[tuple[str, str]]]


def _claim_texts(value: Any) -> builtins.list[str]:
    if isinstance(value, str):
        return [value.strip()]
    if isinstance(value, list):
        return [v.strip() for v in value if isinstance(v, str) and v.strip()]
    return []


def mapped_sso_role(
    services: Any, claims: dict[str, Any]
) -> RoleAssignment | None:
    """First matching mapping rule's role assignment, or None."""
    if not deployment.is_server_mode(services):
        return None
    cfg = clientconfig.client_config(services)
    extra = cfg.get("extra") if isinstance(cfg, dict) else None
    rules = extra.get("ssoRoleMapping") if isinstance(extra, dict) else None
    if not isinstance(rules, list):
        return None
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        claim_key = str(rule.get("claim") or "").strip()
        role_id = str(rule.get("role") or "").strip()
        values = rule.get("values")
        if not claim_key or not role_id or not isinstance(values, list):
            continue
        texts = _claim_texts(claims.get(claim_key))
        if not texts or not any(v in texts for v in values if isinstance(v, str)):
            continue
        assignment = role_assignment_for(services.db, role_id)
        if assignment is not None:
            return assignment
    return None


def resolve_sso_role_assignment(
    services: Any, claims: dict[str, Any]
) -> RoleAssignment | None:
    """Role assignment for a new SSO user: mapped rule, else seeded role."""
    mapped = mapped_sso_role(services, claims)
    if mapped is not None:
        return mapped
    return seeded_user_role_assignment(services.db)

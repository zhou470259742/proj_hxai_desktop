"""Integration tests for deployment mode (standalone vs server) — HX."""

from __future__ import annotations

from tests.support.auth import create_user, resolve_user_id


async def test_deployment_get_defaults(env) -> None:
    c, srv, auth = env
    r = await c.get("/api/deployment", headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "standalone"
    assert body["server_url"] == ""
    assert body["mode_source"] in {"default", "env"}


async def test_deployment_status_is_public(env) -> None:
    c, srv, _auth = env
    # No Authorization header — the login page calls this pre-auth.
    r = await c.get("/api/deployment/status")
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"mode", "server_url"}


async def test_deployment_put_requires_admin(env) -> None:
    c, srv, auth = env
    bob_auth = await create_user(c, auth, username="bob_deploy")
    r = await c.put(
        "/api/deployment", headers=bob_auth, json={"mode": "server"}
    )
    assert r.status_code == 403, r.text


async def test_deployment_put_validates(env) -> None:
    c, srv, auth = env
    bad = await c.put(
        "/api/deployment",
        headers=auth,
        json={"mode": "server", "server_url": "ftp://x"},
    )
    assert bad.status_code in (400, 422), bad.text
    empty = await c.put("/api/deployment", headers=auth, json={})
    assert empty.status_code == 400, empty.text


async def test_server_mode_blocks_local_registration(env) -> None:
    c, srv, auth = env
    try:
        r = await c.put(
            "/api/deployment",
            headers=auth,
            json={"mode": "server", "server_url": "http://127.0.0.1:8888"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["mode"] == "server"
        assert r.json()["mode_source"] == "setting"

        # Public status reflects the switch without auth.
        s = await c.get("/api/deployment/status")
        assert s.json()["mode"] == "server"

        # Local registration paths are closed.
        u = await c.post(
            "/api/users",
            headers=auth,
            json={"username": "denied_user", "password": "DeniedPass12"},
        )
        assert u.status_code == 403, u.text

        invite = await c.post("/api/users/invites", headers=auth, json={})
        assert invite.status_code == 201, invite.text
        redeem = await c.post(
            "/api/auth/invite/redeem",
            json={
                "code": invite.json()["code"],
                "username": "denied_invitee",
                "password": "DeniedPass12",
            },
        )
        assert redeem.status_code == 403, redeem.text
    finally:
        await c.put("/api/deployment", headers=auth, json={"mode": "standalone"})

    # Back to standalone: local registration works again.
    u = await c.post(
        "/api/users",
        headers=auth,
        json={"username": "allowed_user", "password": "AllowedPass12"},
    )
    assert u.status_code == 201, u.text
    assert await resolve_user_id(c, auth, "allowed_user") is not None


async def test_sso_reconcile_syncs_display_name_in_server_mode(env) -> None:
    c, srv, auth = env
    provider = srv.services.sso_repo.upsert_by_kind(
        "oidc",
        enabled=True,
        display_name="HX",
        issuer="https://idp.example",
        client_id="cid",
        client_secret_enc=None,
        scopes="openid",
        dashboard_origin=None,
    )

    first = await srv.user_manager.resolve_or_create_sso_user(
        provider_id=provider.id,
        subject="ext-1",
        claims={"sub": "ext-1", "name": "旧名字", "email": "u@example.com"},
    )
    assert first.display_name == "旧名字"

    # Standalone: returning login does not overwrite the stored name.
    again = await srv.user_manager.resolve_or_create_sso_user(
        provider_id=provider.id,
        subject="ext-1",
        claims={"sub": "ext-1", "name": "新名字"},
    )
    assert again.display_name == "旧名字"

    # Server mode: claims become authoritative each login.
    r = await c.put(
        "/api/deployment",
        headers=auth,
        json={"mode": "server", "server_url": "http://127.0.0.1:8888"},
    )
    assert r.status_code == 200, r.text
    try:
        synced = await srv.user_manager.resolve_or_create_sso_user(
            provider_id=provider.id,
            subject="ext-1",
            claims={"sub": "ext-1", "name": "新名字"},
        )
        assert synced.display_name == "新名字"
        row = srv.services.user_repo.get(synced.id)
        assert row is not None and row.display_name == "新名字"
    finally:
        await c.put("/api/deployment", headers=auth, json={"mode": "standalone"})


async def test_client_config_pull_and_expose(env, monkeypatch) -> None:
    from octop.infra import clientconfig

    c, srv, auth = env
    calls: list[tuple[str, str | None]] = []

    async def fake_get(url: str, token: str | None):
        calls.append((url, token))
        return {"version": "1.0.0", "features": {"market": True}, "labels": {}}

    monkeypatch.setattr(clientconfig, "_http_get", fake_get)

    # Switch to server mode — PUT triggers a force pull.
    r = await c.put(
        "/api/deployment",
        headers=auth,
        json={"mode": "server", "server_url": "http://127.0.0.1:8888"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["client_config"]["features"]["market"] is True
    assert calls == [("http://127.0.0.1:8888/v1/client-config", None)]

    # Second read inside TTL uses the cache — no extra HTTP call.
    r2 = await c.get("/api/deployment", headers=auth)
    assert r2.json()["client_config"]["version"] == "1.0.0"
    assert len(calls) == 1

    # Fetch failure keeps the cached copy instead of failing the request.
    async def fail_get(url: str, token: str | None):
        raise RuntimeError("offline")

    monkeypatch.setattr(clientconfig, "_http_get", fail_get)
    kept = await clientconfig.fetch_client_config(srv, force=True)
    assert kept is not None and kept["version"] == "1.0.0"

    await c.put("/api/deployment", headers=auth, json={"mode": "standalone"})


async def test_sso_role_mapping_in_server_mode(env) -> None:
    import json

    from octop.infra import clientconfig
    from octop.infra.db.repos.user_roles import UserRoleRepo

    c, srv, auth = env
    UserRoleRepo(srv.services.db).create(
        user_role_id="legal-staff",
        user_role_name="法务专员",
        permissions=["users"],
        policies=[],
    )
    provider = srv.services.sso_repo.upsert_by_kind(
        "oidc",
        enabled=True,
        display_name="HX",
        issuer="https://idp.example",
        client_id="cid",
        client_secret_enc=None,
        scopes="openid",
        dashboard_origin=None,
    )
    claims = {"sub": "m1", "name": "Mapped", "department": "法务部"}

    # Standalone: mapping ignored — seeded role applies.
    u1 = await srv.user_manager.resolve_or_create_sso_user(
        provider_id=provider.id, subject="m1", claims=claims
    )
    assert u1.role == "user"

    r = await c.put(
        "/api/deployment",
        headers=auth,
        json={"mode": "server", "server_url": "http://127.0.0.1:8888"},
    )
    assert r.status_code == 200, r.text
    srv.services.settings_repo.set(
        clientconfig.SETTING_CLIENT_CONFIG,
        json.dumps(
            {
                "extra": {
                    "ssoRoleMapping": [
                        {"claim": "department", "values": ["法务部"], "role": "legal-staff"}
                    ]
                }
            }
        ),
    )
    try:
        # New user with matching claim gets the mapped role template.
        u2 = await srv.user_manager.resolve_or_create_sso_user(
            provider_id=provider.id,
            subject="m2",
            claims={**claims, "sub": "m2"},
        )
        assert u2.role == "legal-staff"
        assert u2.permissions == ["users"]

        # Returning user reconciles into the mapped role on login.
        u1b = await srv.user_manager.resolve_or_create_sso_user(
            provider_id=provider.id, subject="m1", claims=claims
        )
        assert u1b.role == "legal-staff"

        # Non-matching claim keeps the seeded role.
        u3 = await srv.user_manager.resolve_or_create_sso_user(
            provider_id=provider.id,
            subject="m3",
            claims={"sub": "m3", "name": "x", "department": "研发部"},
        )
        assert u3.role == "user"
    finally:
        await c.put("/api/deployment", headers=auth, json={"mode": "standalone"})


async def test_disabled_user_propagation(env, monkeypatch) -> None:
    from octop.infra import clientconfig
    from octop.infra.users import sso_status_sync

    c, srv, auth = env
    provider = srv.services.sso_repo.upsert_by_kind(
        "oidc",
        enabled=True,
        display_name="HX",
        issuer="http://127.0.0.1:8888",
        client_id="cid",
        client_secret_enc=None,
        scopes="openid",
        dashboard_origin=None,
    )
    user = await srv.user_manager.resolve_or_create_sso_user(
        provider_id=provider.id,
        subject="usr_disabled1",
        claims={"sub": "usr_disabled1", "name": "将被禁用"},
    )
    assert user.id is not None

    # Standalone: sync is a no-op.
    assert await sso_status_sync.sync_disabled_users(srv.services) == 0

    r = await c.put(
        "/api/deployment",
        headers=auth,
        json={"mode": "server", "server_url": "http://127.0.0.1:8888"},
    )
    assert r.status_code == 200, r.text
    try:
        async def statuses(services):
            return [
                {"id": "usr_disabled1", "status": "disabled"},
                {"id": "usr_other", "status": "active"},
            ]

        monkeypatch.setattr(clientconfig, "fetch_user_status", statuses)

        disabled = await sso_status_sync.sync_disabled_users(srv.services)
        assert disabled == 1
        row = srv.services.user_repo.get(user.id)
        assert row is not None and row.disabled

        # Idempotent on repeat runs.
        assert await sso_status_sync.sync_disabled_users(srv.services) == 0
    finally:
        await c.put("/api/deployment", headers=auth, json={"mode": "standalone"})

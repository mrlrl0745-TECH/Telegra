import pytest

from app.config import settings


@pytest.mark.asyncio
async def test_admin_dashboard_controls_and_manual_subscription(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_telegram_ids", "42424242")
    login = await client.post("/api/auth/dev")
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert login.json()["user"]["is_admin"] is True

    stats = await client.get("/api/admin/statistics", headers=headers)
    assert stats.status_code == 200
    assert stats.json()["users_total"] == 1
    users = await client.get("/api/admin/users", headers=headers)
    person = users.json()[0]

    credits = await client.post(f"/api/admin/users/{person['id']}/credits", headers=headers, json={"amount": 3})
    assert credits.status_code == 200
    assert credits.json()["free_generations"] == 6

    subscription = await client.post(f"/api/admin/users/{person['id']}/subscription", headers=headers, json={"type": "yearly"})
    assert subscription.status_code == 200
    detail = await client.get(f"/api/admin/users/{person['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["user"]["subscription_type"] == "yearly"
    assert detail.json()["subscriptions"][0]["type"] == "yearly"

    cannot_block_self = await client.put(f"/api/admin/users/{person['id']}/block", headers=headers, json={"blocked": True})
    assert cannot_block_self.status_code == 400


@pytest.mark.asyncio
async def test_admin_api_rejects_non_admin(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "admin_telegram_ids", "")
    response = await client.get("/api/admin/statistics", headers=auth_headers)
    assert response.status_code == 403

import pytest


@pytest.mark.asyncio
async def test_test_payment_activates_subscription_once(client, auth_headers):
    created = await client.post("/api/payments/create", headers=auth_headers, json={"tariff": "yearly"})
    assert created.status_code == 200
    payment = created.json()
    assert payment["amount"] == 5500
    success = await client.post(f"/api/payments/{payment['id']}/simulate?status=success", headers=auth_headers)
    assert success.status_code == 200
    repeat = await client.post(f"/api/payments/{payment['id']}/simulate?status=success", headers=auth_headers)
    assert repeat.status_code == 200
    subscription = await client.get("/api/subscription", headers=auth_headers)
    assert subscription.json()["active"] is True
    assert subscription.json()["type"] == "yearly"


@pytest.mark.asyncio
async def test_payment_amount_and_status_are_selected_by_server(client, auth_headers):
    created = await client.post(
        "/api/payments/create",
        headers=auth_headers,
        json={"tariff": "monthly", "amount": 1, "status": "success", "user_id": "another-user"},
    )

    assert created.status_code == 200
    assert created.json()["amount"] == 750
    assert created.json()["tariff"] == "monthly"
    assert created.json()["status"] == "pending"
    assert (await client.get("/api/subscription", headers=auth_headers)).json()["active"] is False


@pytest.mark.asyncio
async def test_payment_failed_state_does_not_activate(client, auth_headers):
    created = await client.post("/api/payments/create", headers=auth_headers, json={"tariff": "monthly"})
    assert created.status_code == 200
    failed = await client.post(f"/api/payments/{created.json()['id']}/simulate?status=failed", headers=auth_headers)
    assert failed.status_code == 200
    subscription = await client.get("/api/subscription", headers=auth_headers)
    assert subscription.json()["active"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal_status", ["failed", "cancelled"])
async def test_terminal_payment_status_cannot_be_resurrected(client, auth_headers, terminal_status):
    created = await client.post("/api/payments/create", headers=auth_headers, json={"tariff": "monthly"})
    assert created.status_code == 200

    terminal = await client.post(
        f"/api/payments/{created.json()['id']}/simulate?status={terminal_status}", headers=auth_headers,
    )
    replayed_success = await client.post(
        f"/api/payments/{created.json()['id']}/simulate?status=success", headers=auth_headers,
    )

    assert terminal.status_code == 200
    assert replayed_success.status_code == 200
    assert replayed_success.json()["status"] == terminal_status
    assert (await client.get("/api/subscription", headers=auth_headers)).json()["active"] is False

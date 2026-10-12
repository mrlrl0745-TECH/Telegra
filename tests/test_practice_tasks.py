import pytest
from app.services.ai_types import AIResult, AIProviderError


@pytest.mark.asyncio
async def test_practice_saved_separately_and_charged_once(client, auth_headers, lesson_payload, monkeypatch):
    plan = (await client.post('/api/lessons/generate', headers=auth_headers, json=lesson_payload)).json()
    async def fake(content):
        assert content.lesson_topic == lesson_payload['topic']
        return AIResult(data={'tasks': [dict(question=f'Задание {i}', answer='Ответ', assessment='Критерий') for i in range(5)]}, model='test')
    monkeypatch.setattr('app.main.generate_practice', fake)
    before = (await client.get('/api/users/usage', headers=auth_headers)).json()['free_generations']
    response = await client.post(f"/api/lessons/{plan['id']}/tasks", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()['content_json']['practice_tasks']) == 5
    assert response.json()['content_json']['stages'] == plan['content_json']['stages']
    saved = (await client.get(f"/api/lessons/{plan['id']}", headers=auth_headers)).json()
    assert saved['content_json']['practice_tasks'] == response.json()['content_json']['practice_tasks']
    old_editor = await client.put(f"/api/lessons/{plan['id']}", headers=auth_headers, json=plan['content_json'])
    assert old_editor.status_code == 200
    assert old_editor.json()['content_json']['practice_tasks'] == saved['content_json']['practice_tasks']
    assert (await client.get('/api/users/usage', headers=auth_headers)).json()['free_generations'] == before - 1
    assert (await client.post('/api/lessons/missing/tasks', headers=auth_headers)).status_code == 404
    assert (await client.post(f"/api/lessons/{plan['id']}/tasks")).status_code == 401


@pytest.mark.asyncio
async def test_practice_failure_keeps_credit(client, auth_headers, lesson_payload, monkeypatch):
    plan = (await client.post('/api/lessons/generate', headers=auth_headers, json=lesson_payload)).json()
    async def fail(content):
        raise AIProviderError('timeout')
    monkeypatch.setattr('app.main.generate_practice', fail)
    before = (await client.get('/api/users/usage', headers=auth_headers)).json()['free_generations']
    response = await client.post(f"/api/lessons/{plan['id']}/tasks", headers=auth_headers)
    assert response.status_code == 503
    assert (await client.get('/api/users/usage', headers=auth_headers)).json()['free_generations'] == before

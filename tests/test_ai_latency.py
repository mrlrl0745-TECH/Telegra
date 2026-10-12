import asyncio
import json
import time
import httpx
import pytest
from app.config import settings
from app.services.ai_service import generate_ai_response
from app.services.ai_types import AIProviderError, AIResult
from app.services.google_ai_service import GoogleAIService
from app.services.lesson_generator import lesson_output_schema

class Provider:
    def __init__(self, *, delay=0, code=None, data=None):
        self.delay, self.code, self.data = delay, code, data or {'ok':True}
        self.calls=0
        self.cancelled=False
    async def generate_json(self, messages):
        self.calls+=1
        try:
            await asyncio.sleep(self.delay)
        except asyncio.CancelledError:
            self.cancelled=True
            raise
        if self.code: raise AIProviderError(self.code)
        return AIResult(data=self.data,model='test')

@pytest.fixture
def budgets(monkeypatch):
    monkeypatch.setattr(settings,'ai_provider','google')
    monkeypatch.setattr(settings,'openrouter_api_key','test-only')
    monkeypatch.setattr(settings,'ai_primary_timeout',.05)
    monkeypatch.setattr(settings,'ai_fallback_timeout',.05)
    monkeypatch.setattr(settings,'ai_total_timeout',.5)

@pytest.mark.asyncio
async def test_success_does_not_call_fallback(budgets):
    primary,fallback=Provider(),Provider()
    result=await generate_ai_response([],google_service=primary,openrouter_service=fallback)
    assert result.data=={'ok':True}
    assert (primary.calls,fallback.calls)==(1,0)

@pytest.mark.asyncio
async def test_primary_timeout_is_cancelled_before_fallback(budgets):
    primary,fallback=Provider(delay=2),Provider()
    await generate_ai_response([],google_service=primary,openrouter_service=fallback)
    assert primary.cancelled and (primary.calls,fallback.calls)==(1,1)

@pytest.mark.asyncio
async def test_total_deadline_bounds_slow_providers(budgets,monkeypatch):
    monkeypatch.setattr(settings,'ai_total_timeout',.08)
    primary,fallback=Provider(delay=2),Provider(delay=2)
    start=time.monotonic()
    with pytest.raises(AIProviderError) as exc:
        await generate_ai_response([],google_service=primary,openrouter_service=fallback)
    assert exc.value.code=='timeout'
    assert time.monotonic()-start < .5
    assert primary.cancelled and fallback.cancelled
    assert (primary.calls,fallback.calls)==(1,1)

@pytest.mark.asyncio
async def test_schema_error_uses_one_fallback_without_repair_loop(budgets):
    primary,fallback=Provider(data={'invalid':True}),Provider()
    def validate(result):
        if 'invalid' in result.data: raise AIProviderError('invalid_schema')
        return result
    await generate_ai_response([],google_service=primary,openrouter_service=fallback,validate=validate)
    assert (primary.calls,fallback.calls)==(1,1)

@pytest.mark.asyncio
async def test_direct_openrouter_stays_single_attempt(budgets,monkeypatch):
    monkeypatch.setattr(settings,'ai_provider','openrouter')
    primary,fallback=Provider(),Provider(code='unavailable')
    with pytest.raises(AIProviderError):
        await generate_ai_response([],google_service=primary,openrouter_service=fallback)
    assert (primary.calls,fallback.calls)==(0,1)

@pytest.mark.asyncio
async def test_google_enforces_schema_and_does_not_join_thought_parts(monkeypatch):
    monkeypatch.setattr(settings,'google_ai_api_key','test-only')
    monkeypatch.setattr(settings,'google_ai_model','gemini-3.5-flash-lite')
    schema=lesson_output_schema()
    def handle(request):
        config=json.loads(request.content)['generationConfig']
        assert config['responseJsonSchema']==schema
        assert config['thinkingConfig']=={'thinkingLevel':'minimal'}
        assert 'teacher_name' not in config['responseJsonSchema']['properties']
        return httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':'Do not parse thoughts','thought':True},{'text':'{"ok":true}'}]}}]})
    service=GoogleAIService(lambda **kwargs:httpx.AsyncClient(transport=httpx.MockTransport(handle),**kwargs))
    service.response_schema=schema
    result=await service.generate_json([{'role':'user','content':'test'}])
    assert result.data=={'ok':True}

@pytest.mark.asyncio
async def test_truncated_response_is_rejected_without_nested_retry(monkeypatch):
    monkeypatch.setattr(settings,'google_ai_api_key','test-only')
    calls=[]
    def handle(request):
        calls.append(request)
        return httpx.Response(200,json={'candidates':[{'finishReason':'MAX_TOKENS','content':{'parts':[{'text':'{"ok":true}'}]}}]})
    service=GoogleAIService(lambda **kwargs:httpx.AsyncClient(transport=httpx.MockTransport(handle),**kwargs))
    with pytest.raises(AIProviderError) as exc:await service.generate_json([{'role':'user','content':'test'}])
    assert exc.value.code=='incomplete_response'
    assert len(calls)==1

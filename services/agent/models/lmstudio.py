import json
import os
import re
import time
from typing import Any, Dict, Optional

import requests

from services.agent.inference_broker import inference_broker
from services.agent.models.base import BaseModel
from services.agent.token_budget import approximate_tokens, bounded_payload


class ModelError(RuntimeError):
    code = 'model_error'


class ModelContextOverflow(ModelError):
    code = 'context_overflow'


class ModelUnavailable(ModelError):
    code = 'model_unavailable'


class ModelTimeout(ModelError):
    code = 'model_timeout'


class ModelInvalidOutput(ModelError):
    code = 'invalid_output'


def _truthy(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _worker_host_enabled():
    value = str(os.getenv('MAILMATE_WORKER_HOST', '')).strip().lower()
    return bool(value) and value not in {'0', 'false', 'no', 'off'}


class LMStudioModel(BaseModel):
    """Role-aware LM Studio adapter with bounded prompts and classified failures."""

    def __init__(self, base_url: Optional[str] = None, model: Optional[str] = None, timeout: int = 35):
        self.base_url = (base_url or os.getenv('LM_STUDIO_BASE_URL', 'http://127.0.0.1:2806/v1')).rstrip('/')
        self.remote_worker_url = os.getenv('MAILMATE_REMOTE_WORKER_URL', 'http://100.114.2.88:5000/api/compute').strip().rstrip('/')
        self.worker_token = os.getenv('MAILMATE_WORKER_TOKEN', '').strip()
        self.model = model or os.getenv('LM_STUDIO_MODEL', 'qwen/qwen3.5-4b')
        self.timeout = timeout
        self.last_provider = None
        self.last_metrics = {}

    @staticmethod
    def _completion_url(base_url: str, worker: bool = False) -> str:
        base = (base_url or '').rstrip('/')
        if worker:
            return f'{base}/chat/completions' if base.endswith('/v1') else f'{base}/v1/chat/completions'
        return f'{base}/chat/completions'

    def _routes(self):
        is_host = _worker_host_enabled()
        client_local = _truthy(os.getenv('MAILMATE_CLIENT_LOCAL_LM'))
        if is_host:
            return [('local_lm_studio', self._completion_url(self.base_url), {})]

        routes = []
        if client_local:
            routes.append(('local_lm_studio', self._completion_url(self.base_url), {}))
        if self.remote_worker_url:
            headers = {'Authorization': f'Bearer {self.worker_token}'} if self.worker_token else {}
            routes.append(('remote_local_worker', self._completion_url(self.remote_worker_url, worker=True), headers))
        return routes

    @staticmethod
    def _raise_http_error(provider, response):
        detail = str(response.text or '')[:600]
        lower = detail.lower()
        if response.status_code == 400 and ('context' in lower or 'token' in lower):
            raise ModelContextOverflow(f'{provider} rejected the prompt: context length exceeded')
        if 400 <= response.status_code < 500:
            raise ModelUnavailable(f'{provider} HTTP {response.status_code}: {detail or "request rejected"}')
        raise ModelUnavailable(f'{provider} HTTP {response.status_code}')

    def _post(self, url, provider, payload, headers):
        last_error = None
        for attempt in range(2):
            if attempt:
                time.sleep(0.25)
            try:
                response = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            except requests.Timeout as exc:
                last_error = ModelTimeout(f'{provider} timed out')
                continue
            except requests.ConnectionError as exc:
                last_error = ModelUnavailable(f'{provider} connection failed: {exc}')
                continue
            except requests.RequestException as exc:
                raise ModelUnavailable(f'{provider} request failed: {exc}') from exc

            if response.ok:
                try:
                    return response.json()
                except ValueError as exc:
                    raise ModelInvalidOutput(f'{provider} returned invalid JSON') from exc
            if response.status_code not in {502, 503, 504}:
                self._raise_http_error(provider, response)
            last_error = ModelUnavailable(f'{provider} transient HTTP {response.status_code}')
        raise last_error or ModelUnavailable(f'{provider} is unavailable')

    def _request_completion(self, payload: Dict[str, Any], request_kind='work', max_input_tokens=3500) -> Dict[str, Any]:
        bounded = bounded_payload(payload, max_input_tokens=max_input_tokens)
        bounded.setdefault('chat_template_kwargs', {})['enable_thinking'] = False
        routes = self._routes()
        if not routes:
            raise ModelUnavailable('No model route is configured for this Mailmate role')

        started = time.perf_counter()
        with inference_broker.slot(request_kind):
            route_errors = []
            response_json = None
            for provider, url, headers in routes:
                try:
                    request_headers = dict(headers)
                    request_headers['X-Mailmate-Request-Kind'] = request_kind
                    response_json = self._post(url, provider, bounded, request_headers)
                    self.last_provider = provider
                    break
                except (ModelContextOverflow, ModelInvalidOutput):
                    raise
                except ModelError as exc:
                    route_errors.append(exc)
            if response_json is None:
                raise route_errors[-1] if route_errors else ModelUnavailable('No model route is available')

        choices = response_json.get('choices') or []
        message = (choices[0].get('message') or {}) if choices else {}
        finish_reason = choices[0].get('finish_reason') if choices else None
        content = str(message.get('content') or '').strip()
        reasoning = str(message.get('reasoning_content') or '').strip()
        if not content and (finish_reason == 'length' or reasoning):
            raise ModelInvalidOutput('Model produced no usable content; thinking consumed the response budget')

        self.last_metrics = {
            'request_kind': request_kind,
            'input_tokens_approx': sum(approximate_tokens(item.get('content') or '') for item in bounded.get('messages') or []),
            'model_latency_ms': round((time.perf_counter() - started) * 1000),
            'provider': self.last_provider,
        }
        return response_json

    def plan(self, goal: str, context: str, tools: Dict[str, Any], session: Any) -> Dict[str, Any]:
        tool_descriptions = '\n'.join(f"- {name}: {tool['description']}" for name, tool in tools.items())
        system_prompt = (
            "You are Mailmate's preparatory work runtime. Choose one safe next tool. "
            "Never send email or alter a calendar. Return JSON only.\n"
            f"Tools:\n{tool_descriptions}\n"
            'Schema: {"thought":"brief rationale","action":"tool_name","args":{}}. '
            "When preparation is complete, call work.finish."
        )
        user_prompt = f'GOAL: {goal}\nSTATE:\n{context}\nChoose the next action.'
        payload = {
            'model': self.model,
            'temperature': 0.1,
            'max_tokens': 400,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
        }
        response_json = self._request_completion(payload, request_kind='work', max_input_tokens=3000)
        try:
            content = str(response_json['choices'][0]['message'].get('content') or '')
        except Exception as exc:
            raise ModelInvalidOutput(f'Invalid model response shape: {exc}') from exc
        clean = re.sub(r'^```(?:json)?\s*|\s*```$', '', content.strip(), flags=re.I)
        match = re.search(r'\{[\s\S]*\}', clean)
        if match:
            try:
                parsed = json.loads(match.group(0))
                if 'action' in parsed:
                    return parsed
            except Exception:
                pass
        raise ModelInvalidOutput('No structured action JSON found in model completion')

    def work_plan(self, source_email: Dict[str, Any]) -> Dict[str, Any]:
        source = source_email or {}
        compact_source = {
            'subject': str(source.get('subject') or '')[:180],
            'sender': str(source.get('sender') or '')[:160],
            'snippet': str(source.get('snippet') or '')[:1400],
            'deadline': str(source.get('deadline') or '')[:80],
            'direction': str(source.get('direction') or '')[:20],
        }
        payload = {
            'model': self.model,
            'temperature': 0.1,
            'max_tokens': 500,
            'messages': [
                {
                    'role': 'system',
                    'content': (
                        'Create one practical Mailmate WorkPlan from the privacy-approved email. '
                        'Do not send anything. Return JSON only with summary, requirements, checklist, '
                        'reply {subject, body}, and optional artifacts [{type, filename, spec}]. '
                        'Use at most 6 checklist items and 2 artifacts.'
                    ),
                },
                {'role': 'user', 'content': json.dumps(compact_source, ensure_ascii=False, separators=(',', ':'))},
            ],
        }
        response = self._request_completion(payload, request_kind='work', max_input_tokens=1600)
        content = str(response['choices'][0]['message'].get('content') or '').strip()
        clean = re.sub(r'^```(?:json)?\s*|\s*```$', '', content, flags=re.I)
        match = re.search(r'\{[\s\S]*\}', clean)
        if not match:
            raise ModelInvalidOutput('No WorkPlan JSON found in model completion')
        try:
            plan = json.loads(match.group(0))
        except ValueError as exc:
            raise ModelInvalidOutput('WorkPlan was not valid JSON') from exc
        if not isinstance(plan, dict) or not isinstance(plan.get('checklist'), list):
            raise ModelInvalidOutput('WorkPlan is missing its checklist')
        return plan

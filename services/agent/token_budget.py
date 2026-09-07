import json
from copy import deepcopy


DEFAULT_INPUT_TOKENS = 3500


def approximate_tokens(value):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return max(1, (len(value) + 3) // 4)


def _truncate_text(text, max_chars):
    text = str(text or '')
    if len(text) <= max_chars:
        return text
    if max_chars < 80:
        return text[:max_chars]
    head = int(max_chars * 0.68)
    tail = max_chars - head - 20
    return f'{text[:head]}\n...[truncated]...\n{text[-tail:]}'


def bound_messages(messages, max_input_tokens=DEFAULT_INPUT_TOKENS):
    """Return an OpenAI-compatible message list within a conservative token budget."""
    clean = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        item = deepcopy(message)
        item['content'] = str(item.get('content') or '')
        clean.append(item)

    max_chars = max(400, int(max_input_tokens) * 4)
    if sum(len(item['content']) for item in clean) <= max_chars:
        return clean

    fixed_overhead = 48 * len(clean)
    available = max(200, max_chars - fixed_overhead)
    weights = []
    for index, item in enumerate(clean):
        role = item.get('role')
        weight = 1.25 if role == 'system' else 1.0
        if index == len(clean) - 1:
            weight += 1.5
        weights.append(weight)
    total_weight = sum(weights) or 1

    for item, weight in zip(clean, weights):
        allowance = max(120, int(available * weight / total_weight))
        item['content'] = _truncate_text(item['content'], allowance)

    while sum(len(item['content']) for item in clean) > max_chars:
        largest = max(clean, key=lambda item: len(item['content']))
        largest['content'] = _truncate_text(largest['content'], max(80, len(largest['content']) - 256))
    return clean


def bounded_payload(payload, max_input_tokens=DEFAULT_INPUT_TOKENS):
    result = deepcopy(payload or {})
    result['messages'] = bound_messages(result.get('messages') or [], max_input_tokens)
    return result

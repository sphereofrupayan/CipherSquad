import re
from copy import deepcopy
from datetime import datetime, timezone


DERIVED_SOURCES = {'ai', 'deadline', 'email', 'attention', 'work', 'virtual'}


def _parse_datetime(value):
    if not value or len(str(value)) <= 10:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _marker(event):
    harness = event.get('agent_harness') or {}
    return str(
        event.get('marker')
        or event.get('source_message_id')
        or harness.get('agent_harness_marker')
        or harness.get('source_message_id')
        or ''
    ).strip()


def _normalized_title(event):
    return re.sub(r'[^a-z0-9]+', ' ', str(event.get('title') or '')).strip().lower()


def _valid_interval(event):
    start = _parse_datetime(event.get('start'))
    end = _parse_datetime(event.get('end'))
    return (start, end) if start and end and start < end else (None, None)


def is_blocking_event(event):
    source = str(event.get('source') or 'google').strip().lower()
    start, end = _valid_interval(event)
    if source in DERIVED_SOURCES:
        return False
    if source != 'google' or event.get('all_day') or not start or not end:
        return False
    if event.get('status') == 'cancelled' or event.get('cancelled') is True:
        return False
    if event.get('transparency') == 'transparent':
        return False
    return event.get('blocking') is not False


def _same_logical_event(first, second):
    first_marker, second_marker = _marker(first), _marker(second)
    if first_marker and second_marker and first_marker == second_marker:
        return True
    first_id, second_id = str(first.get('id') or ''), str(second.get('id') or '')
    if first_id and second_id and first_id == second_id:
        return True
    if not _normalized_title(first) or _normalized_title(first) != _normalized_title(second):
        return False
    first_start, first_end = _valid_interval(first)
    second_start, second_end = _valid_interval(second)
    if not all((first_start, first_end, second_start, second_end)):
        return False
    tolerance_seconds = 5 * 60
    return (
        abs((first_start - second_start).total_seconds()) <= tolerance_seconds
        and abs((first_end - second_end).total_seconds()) <= tolerance_seconds
    )


def _canonical_score(event):
    return (
        1 if is_blocking_event(event) else 0,
        1 if str(event.get('source') or 'google').lower() == 'google' else 0,
        1 if event.get('html_link') else 0,
    )


def deduplicate_events(events):
    unique = []
    for raw in events or []:
        candidate = deepcopy(raw)
        duplicate_index = next(
            (index for index, existing in enumerate(unique) if _same_logical_event(existing, candidate)),
            None,
        )
        if duplicate_index is None:
            unique.append(candidate)
        elif _canonical_score(candidate) > _canonical_score(unique[duplicate_index]):
            unique[duplicate_index] = candidate
    return unique


def calculate_conflicts(events):
    clean_events = deduplicate_events(events)
    for event in clean_events:
        event['conflict'] = False
        event['conflict_with'] = []
        event['blocking'] = is_blocking_event(event)

    candidates = []
    for event in clean_events:
        start, end = _valid_interval(event)
        if event['blocking'] and start and end:
            candidates.append((event, start, end))

    pairs = []
    seen_pairs = set()
    for index, (first, first_start, first_end) in enumerate(candidates):
        for second, second_start, second_end in candidates[index + 1:]:
            if _same_logical_event(first, second):
                continue
            if first_start < second_end and second_start < first_end:
                first_id, second_id = str(first.get('id') or ''), str(second.get('id') or '')
                pair_key = tuple(sorted((first_id, second_id)))
                if not first_id or not second_id or first_id == second_id or pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                overlap = (min(first_end, second_end) - max(first_start, second_start)).total_seconds() / 60
                pairs.append({'a': first_id, 'b': second_id, 'overlapMinutes': round(overlap, 2)})
                first['conflict'] = True
                second['conflict'] = True
                first['conflict_with'].append({'id': second_id, 'title': second.get('title')})
                second['conflict_with'].append({'id': first_id, 'title': first.get('title')})

    return clean_events, pairs

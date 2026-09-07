from services.calendar_conflicts import calculate_conflicts


def event(event_id, start='2026-09-08T10:00:00+05:30', end='2026-09-08T11:00:00+05:30', **overrides):
    value = {
        'id': event_id,
        'title': overrides.pop('title', f'Event {event_id}'),
        'start': start,
        'end': end,
        'source': 'google',
        'all_day': False,
        'status': 'confirmed',
        'transparency': 'opaque',
    }
    value.update(overrides)
    return value


def pairs_for(*events):
    annotated, pairs = calculate_conflicts(events)
    return annotated, pairs


def test_one_event_has_no_conflict():
    annotated, pairs = pairs_for(event('a'))
    assert pairs == []
    assert annotated[0]['conflict'] is False


def test_one_email_deadline_has_no_conflict():
    annotated, pairs = pairs_for(event('deadline-a', source='deadline'))
    assert pairs == []
    assert annotated[0]['blocking'] is False


def test_two_email_deadlines_at_the_same_time_have_no_conflict():
    annotated, pairs = pairs_for(
        event('deadline-a', source='deadline'),
        event('deadline-b', source='deadline'),
    )
    assert pairs == []
    assert not any(item['conflict'] for item in annotated)


def test_google_event_and_matching_virtual_deadline_are_deduplicated():
    annotated, pairs = pairs_for(
        event('google-a', title='DA submission', agent_harness={'agent_harness_marker': 'gmail-123'}),
        event('virtual-a', title='DA submission', source='deadline', marker='gmail-123'),
    )
    assert len(annotated) == 1
    assert annotated[0]['id'] == 'google-a'
    assert pairs == []


def test_adjacent_events_do_not_overlap():
    _, pairs = pairs_for(
        event('a', end='2026-09-08T11:00:00+05:30'),
        event('b', start='2026-09-08T11:00:00+05:30', end='2026-09-08T12:00:00+05:30'),
    )
    assert pairs == []


def test_two_real_overlapping_google_events_create_one_pair():
    annotated, pairs = pairs_for(
        event('a'),
        event('b', start='2026-09-08T10:30:00+05:30', end='2026-09-08T11:30:00+05:30'),
    )
    assert pairs == [{'a': 'a', 'b': 'b', 'overlapMinutes': 30.0}]
    assert {item['id'] for item in annotated if item['conflict']} == {'a', 'b'}


def test_duplicate_google_and_ai_representations_do_not_conflict():
    annotated, pairs = pairs_for(
        event('google-a', title='Project review', agent_harness={'agent_harness_marker': 'mailmate-7'}),
        event('ai-a', title='Project review', source='ai', marker='mailmate-7'),
    )
    assert len(annotated) == 1
    assert pairs == []


def test_rescheduled_or_deleted_conflict_clears_previous_flags():
    original, pairs = pairs_for(
        event('a'),
        event('b', start='2026-09-08T10:30:00+05:30', end='2026-09-08T11:30:00+05:30'),
    )
    assert len(pairs) == 1

    original[0]['end'] = '2026-09-08T10:00:00+05:30'
    original[1]['start'] = '2026-09-08T11:00:00+05:30'
    refreshed, refreshed_pairs = calculate_conflicts(original)
    assert refreshed_pairs == []
    assert all(item['conflict'] is False and item['conflict_with'] == [] for item in refreshed)

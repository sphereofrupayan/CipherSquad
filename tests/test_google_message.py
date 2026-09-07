import base64
from unittest.mock import Mock, patch

from services.google_service import _readable_message_body, mark_gmail_message_read


def _encoded(value):
    return base64.urlsafe_b64encode(value.encode('utf-8')).decode('ascii').rstrip('=')


def test_plain_text_is_preferred_over_html():
    payload = {
        'mimeType': 'multipart/alternative',
        'parts': [
            {'mimeType': 'text/plain', 'body': {'data': _encoded('Plain first\n\nSecond line')}},
            {'mimeType': 'text/html', 'body': {'data': _encoded('<p>HTML fallback</p>')}},
        ],
    }

    assert _readable_message_body(payload) == 'Plain first\n\nSecond line'


def test_html_fallback_is_readable_and_drops_script_content():
    payload = {
        'mimeType': 'text/html',
        'body': {'data': _encoded('<div>Hello &amp; welcome<br><script>bad()</script>Next</div>')},
    }

    assert _readable_message_body(payload) == 'Hello & welcome\nNext'


def test_mark_read_removes_only_the_unread_label():
    execute = Mock(return_value={'id': 'gmail-1', 'threadId': 'thread-1', 'labelIds': ['INBOX']})
    modify = Mock(return_value=Mock(execute=execute))
    service = Mock()
    service.users.return_value.messages.return_value.modify = modify

    with patch('services.google_service._gmail_service', return_value=service):
        result = mark_gmail_message_read('gmail-1')

    modify.assert_called_once_with(
        userId='me',
        id='gmail-1',
        body={'removeLabelIds': ['UNREAD']},
    )
    assert result['is_read'] is True

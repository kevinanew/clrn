"""Export only allowlisted SDK retry metadata from private native logs."""
import re


def summarize(text):
    """Discard raw log lines, bodies, credentials and unrelated service diagnostics."""
    attempts = []
    pattern = (r'SDK request failed: method=(POST) '
               r'url=http://user-transaction-flask/service/v11/wallet/'
               r'([a-f0-9-]{36})/withdraw attempt=([1-3])/3 status_code=(None|[1-5][0-9]{2})')
    for match in re.finditer(pattern, text):
        attempts.append({'method': match[1], 'player': match[2], 'operation': 'withdraw',
                         'attempt': int(match[3]), 'status': None if match[4] == 'None' else int(match[4])})
    return {'source': 'unmodified native texas SDK logger; raw logs discarded', 'attempts': attempts,
            'exceptionNameOccurrences': {name: text.count(name) for name in
                ['ReadTimeout', 'HTTPError', 'ConnectionError', 'JSONDecodeError', 'Request failed after retries']}}

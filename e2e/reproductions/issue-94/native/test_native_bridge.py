"""Keep genuine null/error RPC replies intact and allow subsequent publications."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from sdk_diagnostics import summarize

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / 'mitmproxy'))


class NativeBridgeTest(unittest.TestCase):
    """Test adapter forwarding only; do not change real engine or SDK behavior."""

    def test_null_reply_does_not_stop_the_native_reader(self):
        """Forward empty/error protocol replies byte-for-byte before the next valid frame."""
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'infrastructure.json').write_text('{}')
            with patch.dict(os.environ, {'ISSUE94_NATIVE_ROOT': directory, 'MITMPROXY_CONTROL_TOKEN': 'test-control-only'}):
                spec = importlib.util.spec_from_file_location('native_bridge_test_target', HERE / 'native_bridge.py')
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
        records, forwarded = [], []
        bridge = SimpleNamespace(record=lambda event, **data: records.append({'event': event, **data}))
        connection = module.NativeConnection(bridge, object(), 'owned-user')
        frames = ['{"id":7,"result":{"data":null}}', '{"id":8,"error":{"code":100,"message":"internal"}}',
                  '{"result":{"channel":"owned-room","data":{"data":{"queue":[]}}}}']
        connection.external.update([7, 8])
        master = SimpleNamespace(commands=SimpleNamespace(call=lambda *args: forwarded.append(args[3])))
        with patch.object(module.ctx, 'master', master, create=True):
            for frame in frames:
                connection.relay_frame(frame)
        self.assertEqual(forwarded, [frame.encode() for frame in frames])
        self.assertIsNone(records[0]['reply']['result']['data'])
        self.assertEqual(records[1]['reply']['error']['code'], 100)
        self.assertEqual(len(records), 3)

    def test_sdk_metadata_export_discards_arbitrary_log_text(self):
        """Keep actual retry status and exception evidence without retaining raw secrets."""
        text = ('Authorization: secret-example\nReadTimeout\nSDK request failed: method=POST '
                'url=http://user-transaction-flask/service/v11/wallet/'
                '11111111-2222-4333-8444-555555555555/withdraw attempt=2/3 status_code=None error=private-text')
        result = summarize(text)
        self.assertEqual(result['attempts'][0]['attempt'], 2)
        self.assertIsNone(result['attempts'][0]['status'])
        self.assertEqual(result['exceptionNameOccurrences']['ReadTimeout'], 1)
        self.assertNotIn('secret-example', json.dumps(result))
        self.assertNotIn('private-text', json.dumps(result))


if __name__ == '__main__':
    unittest.main()

"""隔离依赖选择与浏览器启动诊断的隐私边界。"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_settlement_preflight import BROWSER, browser_failure_diagnostic, browser_working_directory


class SettlementBrowserLauncherTests(unittest.TestCase):
    def install_marker(self, directory):
        manifest = directory / 'node_modules/@playwright/test/package.json'
        manifest.parent.mkdir(parents=True)
        manifest.write_text('{}')

    def test_仅画面依赖可用时不能固定到端到端目录(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            self.install_marker(repository / 'visual')
            self.assertEqual(browser_working_directory(repository, repository), repository / 'visual')

    def test_多项目已安装时优先使用调用方依赖而不串用版本(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            for project in (repository, repository / 'visual', repository / 'e2e'):
                self.install_marker(project)
            for project in (repository, repository / 'visual', repository / 'e2e'):
                self.assertEqual(browser_working_directory(repository, project), project)

    def test_没有已安装依赖时明确失败而不跳过浏览器回归(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            with self.assertRaisesRegex(AssertionError, '依赖未安装.*reason=module-not-found'):
                browser_working_directory(repository, repository)

    def test_子项目缺少自身依赖时不能借用根目录其他版本(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = Path(temporary)
            self.install_marker(repository)
            self.install_marker(repository / 'visual')
            with self.assertRaisesRegex(AssertionError, '依赖未安装.*reason=module-not-found'):
                browser_working_directory(repository, repository / 'e2e')

    def test_真实模块缺失保留阶段和原因但不输出任意启动参数(self):
        with tempfile.TemporaryDirectory() as temporary:
            completed = subprocess.run(['node', '--input-type=module', '-e', BROWSER,
                                        json.dumps({'token': 'offline-private-token'})],
                                       cwd=temporary, capture_output=True, text=True, timeout=10)
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(browser_failure_diagnostic(completed.stderr),
                         'stage=module-import reason=module-not-found')
        self.assertNotIn('offline-private-token', completed.stderr + completed.stdout)
        self.assertNotIn(temporary, completed.stderr + completed.stdout, '启动诊断不输出实际目录')

    def test_真实浏览器启动失败不能输出执行路径或凭据(self):
        with tempfile.TemporaryDirectory() as temporary:
            executable = str(Path(temporary) / 'offline-private-token')
            completed = subprocess.run(['node', '--input-type=module', '-e', BROWSER,
                                        json.dumps({'proxy': 'http://proxy.invalid'})],
                                       cwd=browser_working_directory(), capture_output=True, text=True, timeout=10,
                                       env={**os.environ, 'DIAGNOSTIC_CHROME_PATH': executable})
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(browser_failure_diagnostic(completed.stderr),
                         'stage=browser-launch reason=browser-launch-failed')
        self.assertNotIn(temporary, completed.stderr + completed.stdout)
        self.assertNotIn('offline-private-token', completed.stderr + completed.stdout)

    def test_未知异常正文和伪造诊断字段不能进入断言说明(self):
        secret = 'https://private.service.invalid/?token=offline-secret'
        for stderr in (secret, json.dumps({'event': 'settlement-browser-failure',
                       'stage': secret, 'reason': 'module-not-found'}),
                       json.dumps({'event': 'settlement-browser-failure',
                       'stage': 'browser-launch', 'reason': secret})):
            with self.subTest(stderr=stderr):
                self.assertEqual(browser_failure_diagnostic(stderr), 'stage=unclassified reason=unclassified')
        diagnostic = {'event': 'settlement-browser-failure', 'stage': 'browser-launch',
                      'reason': 'browser-launch-failed', 'message': secret}
        self.assertEqual(browser_failure_diagnostic(secret + '\n' + json.dumps(diagnostic)),
                         'stage=browser-launch reason=browser-launch-failed')

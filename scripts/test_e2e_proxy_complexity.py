"""用一次性源码和真实进程验证 issue 107 的复杂度门禁。"""

import ast
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

CHECKER_PATH = Path(__file__).with_name('e2e-proxy-complexity.py')
sys.path.insert(0, str(CHECKER_PATH.parent))
CHECKER = runpy.run_path(str(CHECKER_PATH))
ENGINE = CHECKER['engine']


def probe(complexity, name='probe'):
    """构造精确复杂度的静态函数，禁用注释不影响决策点。"""
    return f'def {name}(value):  # noqa: C901\n' + '    if value: pass\n' * (complexity - 1)


class ProxyComplexityTests(unittest.TestCase):
    """覆盖固定预算、独立作用域、传递支持模块和错误退出。"""

    def setUp(self):
        """准备包含全部必需路径的一次性目录。"""
        temporary = tempfile.TemporaryDirectory(prefix='clrn-proxy-complexity-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for filename in CHECKER['REQUIRED']:
            self.write(filename, 'def seed(): pass\n')

    def write(self, filename, source):
        """写入测试专用源码，不修改仓库文件。"""
        path = self.root / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding='utf-8')

    def invalid(self):
        """从真实扫描报告提取超限实现。"""
        return ENGINE.violations(CHECKER['scan'](self.root))

    def run_cli(self, *options):
        """复制真实检查器，验证独立进程退出码。"""
        self.write('scripts/e2e-proxy-complexity.py', CHECKER_PATH.read_text())
        self.write('scripts/python-tool-complexity.py', CHECKER_PATH.with_name('python-tool-complexity.py').read_text())
        return subprocess.run([sys.executable, *options, str(self.root / 'scripts/e2e-proxy-complexity.py')],
                              capture_output=True, text=True, timeout=30)

    def test_test_and_support_three_pass_four_fail(self):
        """文件名不含 test 的代理实现也必须采用 3。"""
        for filename in ('test_network_faults.py', 'scenario_fixtures.py', 'response_overrides.py'):
            self.check_budget(f'e2e/mitmproxy/{filename}', ((3, 0), (4, 1)))

    def check_budget(self, filename, values):
        """每个预算边界在相同扫描范围内独立核验。"""
        for value, count in values:
            self.write(filename, probe(value))
            self.assertEqual(len(self.invalid()), count, (filename, value))
        self.write(filename, 'def seed(): pass\n')

    def test_checker_tool_six_pass_seven_fail(self):
        """独立检查工具使用 6，不能放宽代理支持代码。"""
        self.check_budget('scripts/e2e-proxy-complexity.py', ((6, 0), (7, 1)))

    def test_nested_async_class_lambda_and_defaults_are_independent(self):
        """任意深度回调和方法单独计数，不累加到外层。"""
        source = '''
def outer(default=lambda flag: flag and flag and flag and flag):
    async def callback(flag):
        if flag: pass
        if flag: pass
        if flag: pass
    class Support:
        def method(self, flag):
            if flag: pass
            if flag: pass
            if flag: pass
    return lambda flag: flag and flag and flag and flag
'''
        report = ENGINE.measurements(ast.parse(source), 'callbacks.py', 3)
        self.assertEqual(sorted(item['complexity'] for item in report), [1, 4, 4, 4, 4])
        self.assertEqual(len(ENGINE.violations(report)), 4)

    def test_no_assert_uses_radon_decisions(self):
        """断言本身不计数，普通条件和推导式仍采用 Radon 规则。"""
        source = 'def test(flag):\n    assert flag and flag and flag and flag\n'
        self.assertEqual(ENGINE.measurements(ast.parse(source), 'test.py', 3)[0]['complexity'], 1)
        self.write('e2e/mitmproxy/scenario_fixtures.py',
                   'def support(items):\n    return [x for x in items if x and x]\n')
        self.assertEqual(self.invalid()[0]['complexity'], 4)

    def test_adjacent_test_and_transitive_extraction_inherit_three(self):
        """重命名或提取到其他文件不能把测试支持升级为通用工具。"""
        self.write('e2e/mitmproxy/test_visual_control.py', probe(4))
        self.write('e2e/mitmproxy/scenario_fixtures.py', 'import extracted_support\ndef fixture(): pass\n')
        self.write('e2e/mitmproxy/extracted_support.py', 'from helpers import nested\ndef support(): pass\n')
        self.write('e2e/mitmproxy/helpers/nested.py', probe(4))
        self.assertEqual({item['file'] for item in self.invalid()}, {
            'e2e/mitmproxy/test_visual_control.py', 'e2e/mitmproxy/helpers/nested.py'})

    def test_noqa_and_configuration_cannot_disable_cli(self):
        """检查器忽略抑制注释、放宽配置和历史清单。"""
        self.write('e2e/mitmproxy/scenario_fixtures.py', '# ruff: noqa\n' + probe(4))
        self.write('ruff.toml', '[lint.mccabe]\nmax-complexity = 100\n')
        result = self.run_cli()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('复杂度 4（上限 3）', result.stderr)

    def test_cli_success_is_a_nonempty_function_report(self):
        """正常进程输出必须包含实际测量。"""
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('0 个超限', result.stdout)

    def test_missing_dependency_is_nonzero(self):
        """禁用 site-packages 后缺少 Radon 必须阻断。"""
        result = self.run_cli('-S')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('radon', result.stderr)

    def test_parse_failure_is_nonzero(self):
        """语法错误不能被当作空扫描成功。"""
        self.write('e2e/mitmproxy/scenario_fixtures.py', 'def broken(:\n')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SyntaxError', result.stderr)

    def test_missing_required_file_is_nonzero(self):
        """必需源码被删除时不能静默缩减任务范围。"""
        (self.root / 'e2e/mitmproxy/scenario_fixtures.py').unlink()
        self.assertNotEqual(self.run_cli().returncode, 0)

    def test_empty_scan_is_rejected(self):
        """没有任何函数时必须明确失败。"""
        for filename in CHECKER['REQUIRED']:
            self.write(filename, '# empty\n')
        with self.assertRaisesRegex(ValueError, '扫描为空'):
            CHECKER['scan'](self.root)

    def test_empty_task_with_nonempty_checker_is_nonzero(self):
        """即使检查器自身有函数，任务源码全空也必须非零退出。"""
        for name in CHECKER['NAMES']:
            self.write(f'e2e/mitmproxy/{name}.py', '# empty task\n')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('扫描为空', result.stderr)

    def test_actual_scope_is_enforced_without_mutation(self):
        """真实范围包括新增辅助实现，报告只读且全部达到固定预算。"""
        report = CHECKER['scan']()
        self.assertTrue(report)
        self.assertEqual(ENGINE.violations(report), [])
        self.assertIn('e2e/mitmproxy/scenario_http.py', {item['file'] for item in report})
        json.dumps(report)

    def test_existing_lint_python_entry_blocks_over_limit_support(self):
        """在临时 Git 仓库证明 lint:python 的真实调用链阻断超限。"""
        self.assertEqual(self.run_cli().returncode, 0)
        repository = CHECKER_PATH.parent.parent
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True, capture_output=True)
        for filename in ('package.json', 'scripts/python-lines.mjs', 'scripts/source-files.mjs'):
            shutil.copyfile(repository / filename, self.root / filename)
        self.write('scripts/extract-web-package.py', 'def extract(): pass\n')
        self.write('scripts/verify-pre-commit.py', 'def verify(): pass\n')
        self.write('e2e/mitmproxy/scenario_fixtures.py', probe(4))
        result = subprocess.run(['npm', 'run', 'lint:python'], cwd=self.root,
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('scenario_fixtures.py:1:1 probe: 复杂度 4（上限 3）', result.stderr)


if __name__ == '__main__':
    unittest.main()

"""验证视觉代理复杂度门禁的预算边界、独立作用域和真实入口失败行为。"""

import ast
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
CHECKER_PATH = ROOT / 'scripts/visual-proxy-complexity.py'
CHECKER = runpy.run_path(str(CHECKER_PATH))
SUPPORT = 'visual/cases/club/mitmproxy/addon.py'
TOOL = 'scripts/visual-proxy-complexity.py'


def source_with_complexity(value):
    """生成确定 Radon 复杂度的函数。"""
    return 'def probe(flag):\n' + '    if flag: pass\n' * (value - 1)


class VisualProxyComplexityTests(unittest.TestCase):
    """临时仓库只包含本任务路径，不扫描其他任务。"""

    def setUp(self):
        """为每个门禁用例准备隔离的最小完整范围。"""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for filename in CHECKER['initial_scope'](self.root):
            self.write(filename, 'def seed(): pass\n')
        self.copy('scripts/python-tool-complexity.py')

    def write(self, filename, source):
        """创建任意命名测试支持或工具文件。"""
        path = self.root / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding='utf-8')

    def copy(self, filename):
        """复制现有入口文件以验证真实调用链。"""
        destination = self.root / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / filename, destination)

    def run_cli(self, *options):
        """运行真实检查器，允许验证隔离 Python 缺失依赖。"""
        self.copy(TOOL)
        return self.run_prepared(*options)

    def run_prepared(self, *options):
        """运行临时仓库当前检查器，不覆盖其中的静态探针。"""
        return subprocess.run([sys.executable, *options, str(self.root / TOOL)],
                              capture_output=True, text=True, timeout=30)

    def test_support_three_passes_four_fails(self):
        """无 test 后缀的代理支持也必须接受 3、拒绝 4。"""
        for value, status in ((3, 0), (4, 1)):
            with self.subTest(value=value):
                self.write(SUPPORT, source_with_complexity(value))
                result = self.run_cli()
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)

    def test_tool_six_passes_seven_fails(self):
        """独立通用检查工具采用 6，测试支持不得继承工具预算。"""
        for value, count in ((6, 0), (7, 1)):
            with self.subTest(value=value):
                self.write(TOOL, source_with_complexity(value))
                invalid = CHECKER['SHARED']['violations'](CHECKER['scan'](self.root))
                self.assertEqual(len(invalid), count)

    def test_cli_tool_boundary(self):
        """真实入口也必须接受工具 6、拒绝 7。"""
        for value, status in ((6, 0), (7, 1)):
            with self.subTest(value=value):
                self.write(TOOL, CHECKER_PATH.read_text() + '\n' + source_with_complexity(value))
                result = self.run_prepared()
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)

    def test_nested_scopes_are_independent(self):
        """嵌套普通、异步、方法和 lambda 均单独测量。"""
        source = '''
def outer():
    def callback(flag):
        if flag: pass
        if flag: pass
        if flag: pass
    async def async_callback(flag):
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
        report = CHECKER['SHARED']['measurements'](ast.parse(source), SUPPORT, 3)
        self.assertEqual({item['name']: item['complexity'] for item in report},
                         {'outer': 1, 'callback': 4, 'async_callback': 4, 'method': 4, '<lambda>': 4})
        self.assertEqual(len(CHECKER['SHARED']['violations'](report)), 4)

    def test_assertions_do_not_count_and_defaults_are_scanned(self):
        """断言不计分，默认参数和装饰器中的 lambda 不能漏扫。"""
        source = '''
@decorate(lambda flag: flag and flag and flag and flag)
def outer(value=lambda flag: flag and flag and flag and flag):
    assert value and value
'''
        report = CHECKER['SHARED']['measurements'](ast.parse(source), SUPPORT, 3)
        self.assertEqual([item['complexity'] for item in report], [1, 4, 4])

    def test_adjacent_and_transitive_helpers_use_three(self):
        """同目录任意命名实现与跨目录提取模块都不能移出扫描。"""
        self.write(SUPPORT, 'from external.middle import helper\n')
        self.write('external/__init__.py', '')
        self.write('external/middle.py', 'from . import deeper\n')
        self.write('external/deeper.py', source_with_complexity(4))
        self.write('visual/cases/club/mitmproxy/arbitrary.py', source_with_complexity(4))
        invalid = CHECKER['SHARED']['violations'](CHECKER['scan'](self.root))
        self.assertEqual({item['file']: item['limit'] for item in invalid},
                         {'external/deeper.py': 3, 'visual/cases/club/mitmproxy/arbitrary.py': 3})

    def test_unrelated_scope_does_not_need_to_be_clean(self):
        """本任务不要求其他目录达到本范围预算。"""
        self.write('unrelated.py', source_with_complexity(99))
        self.assertEqual(CHECKER['SHARED']['violations'](CHECKER['scan'](self.root)), [])

    def test_disabling_comments_cannot_bypass_cli(self):
        """禁用注释和放宽 Ruff 配置均不能抑制独立门禁。"""
        self.write(SUPPORT, '# ruff: noqa\n# noqa: C901\n' + source_with_complexity(4))
        self.write('ruff.toml', '[lint]\nignore = ["C901"]\n')
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn('probe: 复杂度 4（上限 3）', result.stderr)

    def test_parse_error_and_required_file_missing_fail(self):
        """解析失败与必需路径缺失都必须非零退出。"""
        self.write(SUPPORT, 'def broken(')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SyntaxError', result.stderr)
        (self.root / SUPPORT).unlink()
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FileNotFoundError', result.stderr)

    def test_empty_scan_fails(self):
        """没有可测函数时不能报告成功。"""
        for filename in CHECKER['initial_scope'](self.root):
            self.write(filename, '')
        with self.assertRaisesRegex(ValueError, '扫描为空'):
            CHECKER['scan'](self.root)

    def test_missing_radon_fails(self):
        """隔离 Python 不加载第三方包时必须失败。"""
        result = self.run_cli('-I', '-S')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ModuleNotFoundError', result.stderr)
        self.assertIn('radon', result.stderr)

    def test_actual_lint_python_entry_blocks_support_four(self):
        """在一次性仓库执行现有 lint:python，超限应在质量历史清单之前阻断。"""
        self.prepare_lint_entry()
        self.write(SUPPORT, source_with_complexity(4))
        result = subprocess.run(['npm', 'run', 'lint:python'], cwd=self.root,
                                capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('probe: 复杂度 4（上限 3）', result.stderr)
        self.assertNotIn('Cannot find module', result.stderr)

    def prepare_lint_entry(self):
        """复用实际 package 和前置门禁，不创建替代调用链。"""
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        for filename in ('package.json', 'scripts/source-files.mjs', 'scripts/python-lines.mjs',
                         'scripts/extract-web-package.py', 'scripts/verify-pre-commit.py', TOOL):
            self.copy(filename)
        # 上游工具门禁的其余相邻模块无需参与这次静态负例。
        scripts = json.loads((self.root / 'package.json').read_text())['scripts']
        self.assertIn('lint:python:visual-proxies', scripts['lint:python'])


if __name__ == '__main__':
    unittest.main()

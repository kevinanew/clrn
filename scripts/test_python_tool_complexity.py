"""以静态正负例和真实进程验证 issue 108 的复杂度硬门禁。"""

import ast
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest

CHECKER_PATH = Path(__file__).with_name("python-tool-complexity.py")
CHECKER = runpy.run_path(str(CHECKER_PATH))


def source_with_complexity(value):
    """生成恰好指定 Radon 复杂度的独立函数。"""
    return "def probe(flag):\n" + "    if flag: pass\n" * (value - 1)


class PythonToolComplexityTests(unittest.TestCase):
    """覆盖预算、作用域、传递依赖以及所有拒绝空跑的条件。"""

    def setUp(self):
        """用最小任务范围创建一次性仓库，不执行外部业务测试。"""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "scripts").mkdir()
        for filename in CHECKER["REQUIRED"]:
            (self.root / filename).write_text("def seed(): pass\n")

    def write(self, filename, source):
        """写入脚本或测试辅助模块。"""
        (self.root / "scripts" / filename).write_text(source, encoding="utf-8")

    def run_cli(self, *options):
        """运行复制后的真实检查器，保留退出码和标准诊断。"""
        self.write("python-tool-complexity.py", CHECKER_PATH.read_text())
        return subprocess.run([sys.executable, *options, str(self.root / "scripts/python-tool-complexity.py")],
                              capture_output=True, text=True, timeout=30)

    def test_test_three_passes_four_fails(self):
        """测试入口必须严格接受 3、拒绝 4。"""
        for value, count in ((3, 0), (4, 1)):
            with self.subTest(value=value):
                self.write("verify-pre-commit.py", source_with_complexity(value))
                invalid = CHECKER["violations"](CHECKER["scan"](self.root))
                self.assertEqual(len(invalid), count)

    def test_tool_six_passes_seven_fails(self):
        """通用工具必须严格接受 6、拒绝 7。"""
        for value, count in ((6, 0), (7, 1)):
            with self.subTest(value=value):
                self.write("extract-web-package.py", source_with_complexity(value))
                self.assertEqual(len(CHECKER["violations"](CHECKER["scan"](self.root))), count)

    def test_nested_functions_classes_async_and_lambdas_are_independent(self):
        """回调及方法单独计数，外层不累加内部作用域决策点。"""
        source = '''
def outer():
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
        report = CHECKER["measurements"](ast.parse(source), "support.py", 3)
        self.assertEqual({item["name"]: item["complexity"] for item in report},
                         {"outer": 1, "callback": 4, "method": 4, "<lambda>": 4})
        self.assertEqual(len(CHECKER["violations"](report)), 3)

    def test_lambda_in_defaults_and_decorators_is_scanned(self):
        """默认参数和装饰器中的 lambda 也必须独立检查。"""
        source = '''
@decorate(lambda flag: flag and flag and flag and flag)
def outer(value=lambda flag: flag and flag and flag and flag):
    return value
'''
        report = CHECKER["measurements"](ast.parse(source), "support.py", 3)
        self.assertEqual([item["complexity"] for item in report], [1, 4, 4])

    def test_radon_decisions_and_no_assert(self):
        """保持 Radon 的布尔、条件表达式、推导、循环、异常与 match 规则。"""
        bodies = (
            ("assert flag and flag\nassert flag", 1),
            ("return flag and flag or flag", 3),
            ("return 1 if flag else 0", 2),
            ("return [item for item in flag if item]", 3),
            ("for item in flag:\n    pass\nelse:\n    pass", 3),
            ("try:\n    pass\nexcept ValueError:\n    pass\nelse:\n    pass", 3),
            ("match flag:\n    case 1: pass\n    case 2: pass\n    case _: pass", 3),
        )
        for body, expected in bodies:
            with self.subTest(body=body):
                source = "def probe(flag):\n" + "\n".join("    " + line for line in body.splitlines())
                self.assertEqual(CHECKER["measurements"](ast.parse(source), "probe.py", 6)[0]["complexity"], expected)

    def test_adjacent_tests_and_support_without_test_suffix_use_three(self):
        """同名测试和无 test 后缀的测试支持实现都采用 3。"""
        for filename in ("test_extract_web_package.py", "extract-web-package.test.py", "verify_pre_commit_support.py"):
            with self.subTest(filename=filename):
                self.write(filename, source_with_complexity(4))
                invalid = CHECKER["violations"](CHECKER["scan"](self.root))
                self.assertEqual(invalid[-1]["limit"], 3)
                (self.root / "scripts" / filename).unlink()

    def test_extracted_support_is_scanned_transitively(self):
        """提取到任意命名模块或包的测试辅助实现不能逃离扫描。"""
        self.write("verify-pre-commit.py", "from support import helper\ndef seed(): pass\n")
        self.write("support.py", "from deeper import helper\n")
        self.write("deeper.py", source_with_complexity(4))
        invalid = CHECKER["violations"](CHECKER["scan"](self.root))
        self.assertEqual([(item["file"], item["limit"]) for item in invalid], [("scripts/deeper.py", 3)])

    def test_shared_helper_inherits_stricter_test_budget(self):
        """工具和测试共同使用的未登记辅助实现以测试上限为准。"""
        self.write("extract-web-package.py", "import support\n")
        self.write("verify-pre-commit.py", "import support\n")
        self.write("support.py", source_with_complexity(4))
        self.assertEqual(CHECKER["violations"](CHECKER["scan"](self.root))[0]["limit"], 3)

    def test_packages_and_relative_imports_are_scanned(self):
        """点分导入不能漏掉包初始化实现，相对导入继续传播测试预算。"""
        (self.root / "scripts/helpers").mkdir()
        self.write("verify-pre-commit.py", "import helpers.middle\n")
        self.write("helpers/__init__.py", source_with_complexity(4))
        self.write("helpers/middle.py", "from . import deeper\n")
        self.write("helpers/deeper.py", source_with_complexity(4))
        invalid = CHECKER["violations"](CHECKER["scan"](self.root))
        self.assertEqual([(item["file"], item["limit"]) for item in invalid],
                         [("scripts/helpers/__init__.py", 3), ("scripts/helpers/deeper.py", 3)])

    def test_unrelated_files_are_out_of_scope(self):
        """门禁不要求其他目录或未引用的其他工具清零。"""
        self.write("unrelated.py", source_with_complexity(20))
        self.assertEqual(CHECKER["violations"](CHECKER["scan"](self.root)), [])

    def test_disable_comments_do_not_suppress_cli_failure(self):
        """noqa、Ruff 禁用注释和其他配置都不能屏蔽独立 AST 门禁。"""
        self.write("verify-pre-commit.py", "# ruff: noqa\n# noqa: C901\n" + source_with_complexity(4))
        (self.root / "ruff.toml").write_text('[lint]\nignore = ["C901"]\n')
        result = self.run_cli()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("verify-pre-commit.py:3:1 probe: 复杂度 4（上限 3）", result.stderr)

    def test_cli_tool_boundary(self):
        """真实入口同样接受工具 6、阻断 7。"""
        for value, status in ((6, 0), (7, 1)):
            with self.subTest(value=value):
                self.write("extract-web-package.py", source_with_complexity(value))
                self.assertEqual(self.run_cli().returncode, status)

    def test_parse_error_and_missing_file_fail(self):
        """语法错误和必需文件缺失必须产生非零退出码。"""
        self.write("verify-pre-commit.py", "def broken(")
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SyntaxError", result.stderr)
        (self.root / "scripts/verify-pre-commit.py").unlink()
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FileNotFoundError", result.stderr)

    def test_empty_scan_fails(self):
        """没有任何函数时不能以零诊断报告成功。"""
        for filename in CHECKER["REQUIRED"]:
            (self.root / filename).write_text("")
        with self.assertRaisesRegex(ValueError, "扫描为空"):
            CHECKER["scan"](self.root)

    def test_missing_dependency_fails(self):
        """禁用 site-packages 后，缺少 Radon 必须以非零状态退出。"""
        result = self.run_cli("-I", "-S")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ModuleNotFoundError", result.stderr)
        self.assertIn("radon", result.stderr)


if __name__ == "__main__":
    unittest.main()

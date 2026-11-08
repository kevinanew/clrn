"""定向验证 hook 验收脚本的环境、安装检查和快照，不执行全仓检查。"""

import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, call, patch

VERIFY = runpy.run_path(str(Path(__file__).with_name("verify-pre-commit.py")))


class VerifyPreCommitTests(unittest.TestCase):
    """对重构涉及的准备和快照逻辑做单元回归。"""

    def setUp(self):
        """创建独立的快照工作目录。"""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_isolated_environment(self):
        """保留工具环境，移除 Git 控制和跳过 hook 的所有变量。"""
        environment = {
            "PATH": "/tools", "TOKEN": "retained", "GIT_DIR": "/elsewhere",
            "GIT_INDEX_FILE": "/index", "SKIP": "lint", "PRE_COMMIT_ALLOW_NO_CONFIG": "1",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(VERIFY["isolated_environment"](), {"PATH": "/tools", "TOKEN": "retained"})

    def test_executable_hook(self):
        """只有实际可执行的文件才能满足安装检查。"""
        hook = self.root / "pre-commit"
        with self.assertRaisesRegex(AssertionError, "未安装可执行"):
            VERIFY["assert_executable_hook"](hook)
        hook.write_text("#!/bin/sh\n")
        hook.chmod(0o600)
        with self.assertRaisesRegex(AssertionError, "未安装可执行"):
            VERIFY["assert_executable_hook"](hook)
        hook.chmod(0o700)
        VERIFY["assert_executable_hook"](hook)

    def test_setup_keeps_installation_and_environment(self):
        """模拟外部进程，验证克隆、依赖安装和实际 hook 检查仍连接。"""
        acceptance = VERIFY["PreCommitAcceptance"]
        result = subprocess.CompletedProcess([], 0, stdout="baseline\n")
        with patch.object(acceptance, "run_command", return_value=result) as command:
            with patch("subprocess.run") as clone:
                with patch.dict(VERIFY["assert_executable_hook"].__globals__, assert_executable_hook=Mock()) as namespace:
                    self.addCleanup(acceptance.doClassCleanups)
                    acceptance.setUpClass()
                    clone.assert_called_once()
                    self.assertEqual(clone.call_args.kwargs["env"], acceptance.environment)
                    namespace["assert_executable_hook"].assert_called_once_with(acceptance.repository / ".git/hooks/pre-commit")
        self.assertIn(call("npm", "ci"), command.call_args_list)
        self.assertIn(call("uv", "venv", "--python", "3.12.12", ".venv"), command.call_args_list)
        self.assertIn(call("uv", "pip", "install", "--python", acceptance.python, "-r", "requirements-dev.txt"), command.call_args_list)
        self.assertEqual(command.call_args_list[-1], call(acceptance.pre_commit, "install"))
        self.assertEqual(acceptance.environment["GIT_CONFIG_GLOBAL"], os.devnull)
        self.assertEqual(acceptance.environment["PRE_COMMIT_COLOR"], "never")
        self.assertEqual(acceptance.baseline, "baseline\n")

    def test_snapshot_preserves_all_git_state_and_untracked_bytes(self):
        """保留五类 Git 状态及含空格、换行的未跟踪文件原始字节。"""
        name = "untracked name\n.txt"
        (self.root / name).write_bytes(b"\x00\xff\n")
        acceptance = VERIFY["PreCommitAcceptance"]("test_all_files")
        acceptance.repository = self.root
        outputs = ["head", "status", "cached", "diff", "stash", f"{name}\0"]
        results = [subprocess.CompletedProcess([], 0, stdout=value) for value in outputs]
        with patch.object(acceptance, "run_command", side_effect=results) as command:
            self.assertEqual(acceptance.snapshot(), [*outputs[:5], {name: b"\x00\xff\n"}])
        self.assertEqual(command.call_args_list, [
            call("git", "rev-parse", "HEAD"), call("git", "status", "--porcelain=v1"),
            call("git", "diff", "--cached", "--binary"), call("git", "diff", "--binary"),
            call("git", "stash", "list"),
            call("git", "ls-files", "--others", "--exclude-standard", "-z"),
        ])

    def test_empty_untracked_and_read_error(self):
        """空列表不读取目录，未跟踪文件消失时继续传播错误。"""
        acceptance = VERIFY["PreCommitAcceptance"]("test_all_files")
        acceptance.repository = self.root
        with patch.object(acceptance, "run_command", return_value=subprocess.CompletedProcess([], 0, stdout="")):
            self.assertEqual(acceptance.untracked_contents(), {})
        with patch.object(acceptance, "run_command", return_value=subprocess.CompletedProcess([], 0, stdout="missing\0")):
            with self.assertRaises(FileNotFoundError):
                acceptance.untracked_contents()

    def test_acceptance_cases_still_collect(self):
        """只收集真实 hook 场景，确认本次没有删减业务断言用例。"""
        self.assertEqual(unittest.defaultTestLoader.getTestCaseNames(VERIFY["PreCommitAcceptance"]), [
            "test_all_files", "test_document_only_and_deletion_commits",
            "test_lint_errors_block_commits", "test_partial_staging_failure_then_success",
            "test_python_500_lines_commit",
        ])


if __name__ == "__main__":
    unittest.main()

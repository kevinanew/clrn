"""在隔离克隆中验收真实 Git hook，不修改调用者的工作区或索引。"""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class PreCommitAcceptance(unittest.TestCase):
    """复用实际 npm 检查验证安装、提交阻断和修改保留。"""

    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="clrn-pre-commit-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.repository = Path(cls.temporary.name) / "repository"
        cls.environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith("GIT_")
            and key not in {"SKIP", "PRE_COMMIT_ALLOW_NO_CONFIG"}
        }
        cls.environment.update({
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0",
            "PRE_COMMIT_COLOR": "never",
        })
        source = Path(__file__).resolve().parent.parent
        subprocess.run(
            ["git", "clone", "--quiet", "--shared", str(source), str(cls.repository)],
            env=cls.environment, check=True, timeout=120,
        )
        cls.run_command("git", "config", "user.name", "Hook Acceptance")
        cls.run_command("git", "config", "user.email", "hook-acceptance@example.invalid")
        cls.run_command("git", "config", "commit.gpgsign", "false")
        cls.baseline = cls.run_command("git", "rev-parse", "HEAD").stdout
        cls.run_command("npm", "ci")
        cls.run_command("uv", "venv", "--python", "3.12.12", ".venv")
        cls.python = str(cls.repository / ".venv/bin/python")
        cls.pre_commit = str(cls.repository / ".venv/bin/pre-commit")
        cls.run_command(
            "uv", "pip", "install", "--python", cls.python,
            "-r", "requirements-dev.txt",
        )
        cls.run_command(cls.pre_commit, "install")
        hook = cls.repository / ".git/hooks/pre-commit"
        if not hook.is_file() or not os.access(hook, os.X_OK):
            raise AssertionError("未安装可执行的实际 Git hook")

    @classmethod
    def run_command(cls, *arguments, check=True):
        """捕获原始诊断，只在命令不符合预期时打印。"""
        result = subprocess.run(
            arguments, cwd=cls.repository, env=cls.environment,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=600,
        )
        if check and result.returncode != 0:
            raise AssertionError(
                f"命令 {arguments[0]} 退出 {result.returncode}:\n{result.stdout}"
            )
        return result

    def tearDown(self):
        # 仅对本测试创建的临时克隆清理，恢复下一场景的已提交基线。
        self.run_command("git", "reset", "--hard", "--quiet", self.baseline.strip())
        self.run_command("git", "clean", "-fd", "--quiet")

    def snapshot(self):
        """比较 HEAD、索引、工作区差异与未跟踪文件内容。"""
        commands = (
            ("rev-parse", "HEAD"),
            ("status", "--porcelain=v1"),
            ("diff", "--cached", "--binary"),
            ("diff", "--binary"),
            ("stash", "list"),
        )
        state = [self.run_command("git", *command).stdout for command in commands]
        untracked = self.run_command(
            "git", "ls-files", "--others", "--exclude-standard", "-z",
        ).stdout.split("\0")
        state.append({
            name: (self.repository / name).read_bytes() for name in untracked if name
        })
        return state

    def assert_hooks_once(self, output):
        """两个全仓库 hook 每次调用必须各出现一次。"""
        for name in (
            "检查全部源码、工作流与文件长度",
            "检查根目录与视觉子项目的 TypeScript 类型",
        ):
            self.assertEqual(output.count(name), 1, output)

    def commit(self):
        """调用 git commit，由安装的 hook 自行执行检查。"""
        result = self.run_command(
            "git", "commit", "--quiet", "-m", "Verify pre-commit behavior", check=False,
        )
        self.assert_hooks_once(result.stdout)
        return result

    def test_all_files(self):
        before = self.snapshot()
        result = self.run_command(self.pre_commit, "run", "--all-files", "--verbose")
        self.assert_hooks_once(result.stdout)
        for command in ("lint", "typecheck"):
            self.assertEqual(result.stdout.count(f"\n> {command}\n"), 1, result.stdout)
        self.assertEqual(self.snapshot(), before)

    def test_lint_errors_block_commits(self):
        cases = (
            ("hook-acceptance.mjs", "console.log(clrnHookMissing);\n", "no-undef"),
            ("hook_acceptance.py", "print(clrn_hook_missing)\n", "F821"),
            (
                "hook-acceptance.sh",
                "#!/bin/sh\nvalue='two words'\nprintf '%s\\n' $value\n",
                "SC2086",
            ),
        )
        for name, contents, diagnostic in cases:
            with self.subTest(language=name):
                path = self.repository / name
                path.write_text(contents)
                self.run_command("git", "add", name)
                before = self.snapshot()
                result = self.commit()
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertIn(diagnostic, result.stdout)
                self.assertIn(name, result.stdout)
                self.assertEqual(self.snapshot(), before)
                self.run_command("git", "reset", "--quiet", "HEAD", "--", name)
                path.unlink()

    def test_partial_staging_failure_then_success(self):
        name = "hook-acceptance.ts"
        path = self.repository / name
        invalid = 'export const hookAcceptance: number = "invalid";\n'
        valid = "export const hookAcceptance: number = 1;\n"
        unstaged = "// Preserve this unstaged edit.\n"
        note = self.repository / "hook-acceptance-note.md"
        note.write_text("Preserve this untracked file.\n")
        document = self.repository / "README.md"
        document.write_text(document.read_text() + "\nHook acceptance.\n")
        path.write_text(invalid)
        self.run_command("git", "add", name, "README.md")
        path.write_text(invalid + unstaged)
        before = self.snapshot()
        result = self.commit()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("TS2322", result.stdout)
        self.assertIn(name, result.stdout)
        self.assertEqual(self.snapshot(), before)

        path.write_text(valid)
        self.run_command("git", "add", name)
        path.write_text(valid + unstaged)
        result = self.commit()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.run_command("git", "show", f"HEAD:{name}").stdout, valid)
        self.assertEqual(path.read_text(), valid + unstaged)
        self.assertEqual(note.read_text(), "Preserve this untracked file.\n")
        self.assertEqual(self.run_command("git", "diff", "--cached").stdout, "")
        self.assertEqual(self.run_command("git", "stash", "list").stdout, "")
        committed = self.run_command("git", "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
        self.assertEqual(set(committed.stdout.splitlines()), {name, "README.md"})

    def test_document_only_and_deletion_commits(self):
        document = self.repository / "README.md"
        document.write_text(document.read_text() + "\nHook acceptance.\n")
        self.run_command("git", "add", "README.md")
        result = self.commit()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.run_command("git", "rm", "--quiet", "README.md")
        result = self.commit()
        self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)

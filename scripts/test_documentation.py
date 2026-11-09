"""验证 Python 私有实现与 lambda、Shell 用途说明的补充检查。"""

import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("documentation", Path(__file__).with_name("check-documentation.py"))
DOCUMENTATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DOCUMENTATION)
PROJECTION_SPEC = importlib.util.spec_from_file_location("projection", Path(__file__).with_name("documentation-projection.py"))
PROJECTION = importlib.util.module_from_spec(PROJECTION_SPEC)
PROJECTION_SPEC.loader.exec_module(PROJECTION)


class DocumentationTests(unittest.TestCase):
    """核对存在性、非空说明、真实注释与语法失败的边界。"""

    def test_private_and_dunder_methods(self):
        """拒绝私有和特殊方法缺失或空白的用途说明。"""
        source = '"""模块用途。"""\nclass Cache:\n    """缓存用途。"""\n    def _read(self):\n        pass\n    def __init__(self):\n        """  """\n'
        findings = DOCUMENTATION.python_findings(source, "probe.py")
        self.assertEqual(len(findings), 2)
        self.assertTrue(all(item["rule"] == "python-purpose" for item in findings))

    def test_valid_future_and_private(self):
        """保留 future 导入合法位置，并接受中文及英文私有方法说明。"""
        source = '"""缓存模块。"""\nfrom __future__ import annotations\nclass Cache:\n    """存放会话。"""\n    def _read(self):\n        """Read the cached session."""\n        return None\n'
        self.assertEqual(DOCUMENTATION.python_findings(source, "probe.py"), [])

    def test_tags_links_and_examples_are_not_purpose(self):
        """拒绝用参数字段、链接或示例代替 Python 用途首段。"""
        for summary in ["@param value: 输入。", ":param value: 输入。", "Examples:\n    read()", "https://example.invalid",
                        ".. code-block:: python\n\n    read()", "Examples\n--------\nread()",
                        '[参考资料][source]', '`参考资料 <https://example.invalid>`_',
                        '<a href="https://example.invalid">参考资料</a>']:
            source = f'"""模块用途。"""\ndef _read():\n    """{summary}"""\n    pass\n'
            self.assertEqual(len(DOCUMENTATION.python_findings(source, "probe.py")), 1)

    def test_lambda_requires_actual_adjacent_comment(self):
        """拒绝借用字符串或 noqa，接受紧邻 lambda 的具体用途注释。"""
        for prefix in ['', '"# placeholder"\n', '# noqa: D103\n', '# https://example.invalid\n', '# @param value\n',
                       'other = 1  # 仅说明上一条赋值。\n']:
            findings = DOCUMENTATION.python_findings('"""模块用途。"""\n' + prefix + 'read = lambda: 1\n', "probe.py")
            self.assertTrue(any(item["rule"] == "lambda-purpose" for item in findings))
        self.assertEqual(DOCUMENTATION.python_findings('"""模块用途。"""\n# 提供固定索引，用于排序边界验证。\nread = lambda: 1\n', "probe.py"), [])
        self.assertEqual(DOCUMENTATION.python_findings('"""模块用途。"""\nread = lambda: 1  # 提供固定索引。\n', "probe.py"), [])

    def test_syntax_error_is_not_empty_result(self):
        """解析失败必须抛错，不能返回零违规。"""
        with self.assertRaises(SyntaxError):
            DOCUMENTATION.python_findings('def broken(', "probe.py")

    def test_shell_entry_and_both_function_forms(self):
        """覆盖脚本入口、普通函数和 function 形式的紧邻用途说明。"""
        self.assertEqual(len(DOCUMENTATION.shell_findings('#!/bin/bash\nset -e\nread() { :; }\nfunction clear { :; }\n')), 3)
        source = '#!/bin/bash\n# 管理本机缓存。\n# 读取当前缓存。\nread() { :; }\n# 清理本机缓存。\nfunction clear { :; }\n'
        self.assertEqual(DOCUMENTATION.shell_findings(source), [])
        for prefix in ["echo '\n# 这不是注释。'\n", ':; # 仅说明前一条命令。\n']:
            source = '#!/bin/bash\n# 输出说明示例。\n' + prefix + 'read() { :; }\n'
            self.assertEqual(len(DOCUMENTATION.shell_findings(source)), 1)
        self.assertEqual(len(DOCUMENTATION.shell_findings('#!/bin/bash\n# 管理缓存。\nset -e\nread-cache() { :; }\n')), 1)

    def test_projection_preserves_ordinary_strings_and_code(self):
        """只移除新增真实 docstring，保留基线说明、普通字符串与语句。"""
        reference = '"""旧模块说明。"""\ndef read():\n    return "ordinary string"\n'
        current = '"""旧模块说明。"""\ndef read():\n    """读取当前文本。"""\n    return "ordinary string"\n'
        self.assertEqual(PROJECTION.project(current, reference), reference)
        self.assertIn('return "changed string"', PROJECTION.project(current.replace('ordinary string', 'changed string'), reference))

    def test_shell_compound_bodies_and_nested_functions(self):
        """普通函数体、子 shell、条件体、多行声明和嵌套函数均独立检查。"""
        for definition in ['read() ( :; )', 'function read() ( :; )', 'read() if true; then :; fi',
                           'read()\n{ :; }', 'function read\n{ :; }']:
            with self.subTest(definition=definition):
                prefix = '#!/bin/bash\n# 管理缓存。\nset -e\n'
                self.assertEqual(len(DOCUMENTATION.shell_findings(prefix + definition)), 1)
                self.assertEqual(DOCUMENTATION.shell_findings(prefix + '# 读取缓存。\n' + definition), [])
        source = '#!/bin/bash\n# 管理缓存。\n# 准备缓存。\nouter() {\n    inner() { :; }\n}\n'
        self.assertEqual(len(DOCUMENTATION.shell_findings(source)), 1)

    def test_shell_text_and_heredocs_are_not_functions(self):
        """说明或字符串中的伪函数不参与 Shell 实现扫描。"""
        source = '#!/bin/bash\n# 输出说明示例。\necho "\nread() { :; }\n"\ncat <<\'EOF\'\nfunction clear { :; }\nEOF\n'
        self.assertEqual(DOCUMENTATION.shell_findings(source), [])

    def test_shell_empty_summaries_and_syntax_fail(self):
        """Shell 入口和函数不能用标签或链接充数，解析失败必须报错。"""
        for summary in ['https://example.invalid', '@param value', '!!!']:
            source = f'#!/bin/bash\n# {summary}\n# {summary}\nread() {{ :; }}\n'
            self.assertEqual(len(DOCUMENTATION.shell_findings(source)), 2)
        with self.assertRaisesRegex(ValueError, "Shell 语法解析失败"):
            DOCUMENTATION.shell_findings('#!/bin/bash\n# 读取缓存。\nread() {\n')


if __name__ == "__main__":
    unittest.main()

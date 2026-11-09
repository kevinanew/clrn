"""补充检查 Python 私有实现、lambda 与 Shell 入口及函数的用途说明。"""

import ast
import io
import json
import re
import sys
import tokenize
from pathlib import Path

from tree_sitter import Language, Parser
import tree_sitter_bash

SHELL_PARSER = Parser(Language(tree_sitter_bash.language()))


def has_text(text):
    """确认说明包含文字或数字，拒绝空白与标点占位。"""
    return bool(text) and any(character.isalnum() for character in text)


def has_purpose(text):
    """只认可 docstring 首段的用途正文，不把字段、链接和示例段当摘要。"""
    summary = []
    for line in (text or "").strip().splitlines():
        if not line.strip() or re.match(
            r"\s*(?:@\w+|:\w+|```|>>>|\.\.\s|(?:Args|Arguments|Parameters|Returns|Raises|Yields|Attributes|Examples?|See Also|Notes|References)\s*(?::|$))", line
        ):
            break
        summary.append(line)
    prose = re.sub(r'<a\b[^>]*>.*?</a\s*>|\{@[^}]*\}|\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])|`[^`]+`_+|https?://\S+',
                   "", " ".join(summary), flags=re.IGNORECASE)
    return has_text(prose)


def purpose_comment(line):
    """提取用途注释正文，排除 shebang 和工具控制指令。"""
    match = re.match(r"\s*#(.*)$", line)
    comment = match[1].strip() if match else ""
    if comment.startswith(("!", "noqa", "type:", "shellcheck", "coding:")):
        return ""
    return comment


def lambda_comments(node, comments, lines):
    """读取 lambda 同行或前一行独立注释，避免借用上一条语句的行尾说明。"""
    current = comments.get(node.lineno)
    previous = comments.get(node.lineno - 1)
    preceding = ""
    if previous and not lines[previous.start[0] - 1][:previous.start[1]].strip():
        preceding = previous.string
    return current.string if current else "", preceding


def python_findings(source, filename):
    """解析 Python，逐个验证模块、类、私有及公有具名实现和 lambda。"""
    tree = ast.parse(source, filename=filename)
    comments = {token.start[0]: token for token in tokenize.generate_tokens(io.StringIO(source).readline)
                if token.type == tokenize.COMMENT}
    lines = source.splitlines()
    findings = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if not has_purpose(ast.get_docstring(node)):
                findings.append({"line": getattr(node, "lineno", 1), "rule": "python-purpose",
                                 "message": f"{getattr(node, 'name', '模块')} 缺少非空用途 docstring"})
        if isinstance(node, ast.Lambda):
            nearby = lambda_comments(node, comments, lines)
            if not any(has_purpose(purpose_comment(line)) for line in nearby):
                findings.append({"line": node.lineno, "rule": "lambda-purpose", "message": "lambda 缺少紧邻用途注释"})
    return findings


def shell_nodes(node, kind):
    """按节点类型遍历 Bash 真实函数或注释，排除字符串和 heredoc 正文中的同形文本。"""
    if node.type == kind:
        yield node
    for child in node.named_children:
        yield from shell_nodes(child, kind)


def shell_findings(source):
    """解析 Shell 的各种函数体，检查入口及每个具名实现的紧邻用途摘要。"""
    tree = SHELL_PARSER.parse(source.encode("utf-8"))
    if tree.root_node.has_error:
        raise ValueError("Shell 语法解析失败")
    lines = source.splitlines()
    comments = {node.start_point.row: node.text.decode("utf-8") for node in shell_nodes(tree.root_node, "comment")
                if not lines[node.start_point.row][:node.start_point.column].strip()}
    findings = []
    start = 1 if lines and lines[0].startswith("#!") else 0
    if not has_purpose(purpose_comment(comments.get(start, ""))):
        findings.append({"line": start + 1, "rule": "shell-purpose", "message": "Shell 入口缺少用途注释"})
    for node in shell_nodes(tree.root_node, "function_definition"):
        index = node.start_point.row
        if not has_purpose(purpose_comment(comments.get(index - 1, ""))):
            findings.append({"line": index + 1, "rule": "shell-purpose", "message": "Shell 函数缺少紧邻用途注释"})
    return findings


def main():
    """读取统一扫描清单并输出 JSON；文件读取或语法解析失败直接非零退出。"""
    files = json.load(sys.stdin)
    findings = []
    counts = {"python": 0, "shell": 0}
    for filename in files:
        source = Path(filename).read_text(encoding="utf-8")
        if filename.endswith(".py"):
            counts["python"] += 1
            items = python_findings(source, filename)
        elif filename.endswith(".sh"):
            counts["shell"] += 1
            items = shell_findings(source)
        else:
            raise ValueError(f"不支持的源码类型：{filename}")
        findings.extend({"file": filename, **item} for item in items)
    if not counts["python"]:
        raise ValueError("Python 扫描为空")
    print(json.dumps({"files": counts, "findings": findings}, ensure_ascii=False))


if __name__ == "__main__":
    main()

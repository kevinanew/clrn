"""补充检查 Python 私有实现、lambda 与 Shell 入口及函数的用途说明。"""

import ast
import io
import json
import re
import sys
import tokenize
from pathlib import Path


def has_text(text):
    """确认说明包含文字或数字，拒绝空白与标点占位。"""
    return bool(text) and any(character.isalnum() for character in text)


def has_purpose(text):
    """只认可 docstring 首段的用途正文，不把字段、链接和示例段当摘要。"""
    summary = []
    for line in (text or "").strip().splitlines():
        if not line.strip() or re.match(r"\s*(?:@\w+|:\w+|```|>>>|(?:Args|Arguments|Parameters|Returns|Examples?)\s*:)", line):
            break
        summary.append(line)
    prose = re.sub(r"\[[^\]]*\]\([^)]*\)|https?://\S+", "", " ".join(summary))
    return has_text(prose)


def purpose_comment(line):
    """提取用途注释正文，排除 shebang 和工具控制指令。"""
    match = re.match(r"\s*#(.*)$", line)
    comment = match[1].strip() if match else ""
    if comment.startswith(("!", "noqa", "type:", "shellcheck", "coding:")):
        return ""
    return comment


def python_findings(source, filename):
    """解析 Python，逐个验证模块、类、私有及公有具名实现和 lambda。"""
    tree = ast.parse(source, filename=filename)
    comments = {token.start[0]: token.string for token in tokenize.generate_tokens(io.StringIO(source).readline)
                if token.type == tokenize.COMMENT}
    findings = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if not has_purpose(ast.get_docstring(node)):
                findings.append({"line": getattr(node, "lineno", 1), "rule": "python-purpose",
                                 "message": f"{getattr(node, 'name', '模块')} 缺少非空用途 docstring"})
        if isinstance(node, ast.Lambda):
            nearby = [comments.get(node.lineno, ""), comments.get(node.lineno - 1, "")]
            if not any(has_text(purpose_comment(line)) for line in nearby):
                findings.append({"line": node.lineno, "rule": "lambda-purpose", "message": "lambda 缺少紧邻用途注释"})
    return findings


def shell_findings(source):
    """检查 Shell 脚本入口以及两种常用函数声明前的紧邻用途注释。"""
    lines = source.splitlines()
    findings = []
    start = 1 if lines and lines[0].startswith("#!") else 0
    if len(lines) <= start or not has_text(purpose_comment(lines[start])):
        findings.append({"line": start + 1, "rule": "shell-purpose", "message": "Shell 入口缺少用途注释"})
    for index, line in enumerate(lines):
        if re.match(r"\s*(?:function\s+[\w.-]+(?:\s*\(\s*\))?|[\w.-]+\s*\(\s*\))\s*(?:\{|$)", line):
            if index == 0 or not has_text(purpose_comment(lines[index - 1])):
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

"""为只读重复检查移除新增 docstring，保留基线已有文档与全部可执行语法。"""

import ast
import json
import sys


def docstrings(source):
    """定位模块、类和函数首条语句中的真实 docstring，不匹配普通字符串。"""
    tree = ast.parse(source)
    return [node.body[0] for node in ast.walk(tree)
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and ast.get_docstring(node, clean=False) is not None]


def project(source, reference):
    """保留基线中存在的 docstring，仅从临时扫描输入删除新用途说明语句。"""
    known = {node.value.value for node in docstrings(reference)}
    lines = source.splitlines(keepends=True)
    # 从文件末尾逆序处理 docstring，避免前面的替换改变后续节点行号。
    for node in sorted(docstrings(source), key=lambda entry: entry.lineno, reverse=True):
        if node.value.value in known:
            continue
        # 单行实现可能在 docstring 后还有语句；按 UTF-8 字节列移除，保留剩余代码。
        first = lines[node.lineno - 1].encode()
        last = lines[node.end_lineno - 1].encode()
        prefix, suffix = first[:node.col_offset], last[node.end_col_offset:]
        if suffix.lstrip().startswith(b";"):
            suffix = suffix.lstrip()[1:]
        replacement = prefix + suffix
        if not replacement.strip():
            replacement = b""
        lines[node.lineno - 1:node.end_lineno] = [replacement.decode()]
    return "".join(lines)


def main():
    """批量转换 JSON 输入并输出扫描内容，语法或协议错误直接失败。"""
    entries = json.load(sys.stdin)
    print(json.dumps({file: project(value["source"], value["reference"])
                      for file, value in entries.items()}, ensure_ascii=False))


if __name__ == "__main__":
    main()

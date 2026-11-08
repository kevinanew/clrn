"""按 Radon 决策点规则独立检查 issue 108 的工具和测试支持函数。"""

import argparse
import ast
import json
from pathlib import Path
import sys

from radon.visitors import ComplexityVisitor

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = {
    "scripts/extract-web-package.py": 6,
    "scripts/verify-pre-commit.py": 3,
    "scripts/python-tool-complexity.py": 6,
}
PREFIXES = ("extract-web-package", "verify-pre-commit", "python-tool-complexity")
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


class IsolatedComplexity(ComplexityVisitor):
    """复用 Radon 计数，嵌套函数、类和 lambda 另行测量。"""

    def visit_FunctionDef(self, node):
        """跳过独立作用域，避免把内部决策点累加到外层。"""

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_ClassDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef


def function_complexity(node):
    """仅测量当前函数的实现体，断言不增加复杂度。"""
    visitor = IsolatedComplexity(no_assert=True)
    body = [node.body] if isinstance(node, ast.Lambda) else node.body
    for statement in body:
        visitor.visit(statement)
    return visitor.complexity


def measurements(tree, filename, limit):
    """独立枚举普通、异步函数、方法和任意深度 lambda。"""
    result = []
    for node in ast.walk(tree):
        if isinstance(node, FUNCTIONS):
            result.append({
                "file": filename, "line": node.lineno, "column": node.col_offset + 1,
                "name": getattr(node, "name", "<lambda>"),
                "complexity": function_complexity(node), "limit": limit,
            })
    return result


def adjacent_scope(root):
    """包含同名相邻测试和支持模块；只有明确列出的通用工具使用 6。"""
    scope = dict(REQUIRED)
    for path in (root / "scripts").glob("*.py"):
        stem = path.stem.removeprefix("test_").replace("_", "-")
        if stem.startswith(PREFIXES):
            filename = path.relative_to(root).as_posix()
            scope.setdefault(filename, 3)
    return scope


def import_names(node):
    """提取普通导入、from 模块和潜在的子模块名。"""
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]
    module = node.module or ""
    return [module, *[f"{module}.{alias.name}".strip(".") for alias in node.names]]


def import_directories(node, path, root):
    """按脚本目录和仓库根解析本地导入，支持包内相对导入。"""
    if isinstance(node, ast.ImportFrom) and node.level:
        return [path.parents[node.level - 1]]
    return [path.parent, root]


def candidate_modules(node, path, root):
    """列出本地模块及包初始化文件候选，不读取外部依赖实现。"""
    for directory in import_directories(node, path, root):
        for name in import_names(node):
            parts = name.split(".")
            base = directory.joinpath(*parts)
            yield base.with_suffix(".py")
            for depth in range(1, len(parts) + 1):
                yield directory.joinpath(*parts[:depth], "__init__.py")


def local_dependencies(tree, path, root):
    """跟踪范围内实现提取的本地辅助模块，防止移出同名文件后漏扫。"""
    dependencies = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            dependencies.update(candidate_modules(node, path, root))
    return sorted(path for path in dependencies if path.is_file() and path.is_relative_to(root))


def extend_scope(scope, dependencies, limit, root):
    """辅助模块继承调用方上限，测试支持优先使用更严格的 3。"""
    for path in dependencies:
        filename = path.relative_to(root).as_posix()
        inherited = REQUIRED.get(filename, limit)
        scope[filename] = min(scope.get(filename, inherited), inherited)


def scan(root=ROOT):
    """读取完整任务范围及其本地依赖，缺文件、解析失败和空扫描均抛错。"""
    scope = adjacent_scope(root)
    trees = {}
    processed = {}
    while processed != scope:
        for filename, limit in list(scope.items()):
            if processed.get(filename) == limit:
                continue
            path = root / filename
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=filename)
            trees[filename] = tree
            processed[filename] = limit
            extend_scope(scope, local_dependencies(tree, path, root), limit, root)
    result = []
    for filename, tree in sorted(trees.items()):
        result.extend(measurements(tree, filename, scope[filename]))
    if not result:
        raise ValueError("Python 工具复杂度扫描为空")
    return result


def violations(report):
    """不读取历史豁免、noqa 或 Ruff 配置，直接判断每个函数的固定预算。"""
    return [item for item in report if item["complexity"] > item["limit"]]


def main():
    """输出逐函数 JSON 或定向门禁诊断，异常和超限均非零退出。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", action="store_true")
    arguments = parser.parse_args()
    report = scan()
    invalid = violations(report)
    if arguments.report:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Python 工具复杂度：{len(report)} 个函数，{len(invalid)} 个超限。")
    for item in invalid:
        print(f'{item["file"]}:{item["line"]}:{item["column"]} {item["name"]}: '
              f'复杂度 {item["complexity"]}（上限 {item["limit"]}）', file=sys.stderr)
    return int(bool(invalid))


if __name__ == "__main__":
    sys.exit(main())

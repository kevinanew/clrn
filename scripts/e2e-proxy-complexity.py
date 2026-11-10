"""按 Radon 决策点规则检查 issue 107 的代理场景及测试支持。"""

import argparse
import ast
import importlib
import json
from pathlib import Path
import sys

engine = importlib.import_module('python-tool-complexity')
ROOT = Path(__file__).resolve().parent.parent
NAMES = (
    'connection_diagnostics', 'network_faults', 'replay_scenes', 'response_overrides',
    'scenario_fixtures', 'test_connection_diagnostics', 'test_network_faults',
    'test_payment_isolation', 'test_release_connection_lifecycle', 'test_release_http1_close',
    'test_release_lifecycle_integration', 'test_replay_scenes', 'test_response_overrides',
    'test_response_overrides_integration', 'test_scenario_fixtures',
    'test_settlement_browser_launcher', 'test_settlement_preflight', 'test_wallet_statements',
    'visual_control',
)
REQUIRED = {f'e2e/mitmproxy/{name}.py': 3 for name in NAMES}
REQUIRED.update({'scripts/e2e-proxy-complexity.py': 6,
                 'scripts/test_e2e_proxy_complexity.py': 3,
                 'scripts/python-tool-complexity.py': 6})
PREFIXES = ('scenario_', 'replay_', 'diagnostic_', 'e2e_proxy_complexity')


def adjacent_scope(root):
    """必需文件不得缺失，并覆盖相邻同名测试与提取的支持模块。"""
    scope = dict(REQUIRED)
    for path in (root / 'e2e/mitmproxy').glob('*.py'):
        stem = path.stem.removeprefix('test_')
        if stem in NAMES or stem.startswith(PREFIXES):
            scope[path.relative_to(root).as_posix()] = 3
    return scope


def read_dependencies(tree, path, root):
    """跟踪本地导入，防止提取到任意名称的辅助文件后漏扫。"""
    return engine.local_dependencies(tree, path, root)


def scan(root=ROOT):
    """只读扫描固定范围及新本地依赖；缺文件、解析失败和空扫描均抛错。"""
    scope = adjacent_scope(root)
    processed = set()
    report = []
    while pending := scope.keys() - processed:
        for filename in sorted(pending):
            path = root / filename
            tree = ast.parse(path.read_text(encoding='utf-8'), filename=filename)
            report.extend(engine.measurements(tree, filename, scope[filename]))
            processed.add(filename)
            extend_scope(scope, [path, *read_dependencies(tree, path, root)], root)
    if not task_measured(report):
        raise ValueError('E2E 代理复杂度扫描为空')
    return report


def task_measured(report):
    """必须实际测到代理或测试支持函数，不能只扫到检查器自己。"""
    return any(item['file'].startswith('e2e/mitmproxy/') for item in report)


def extend_scope(scope, dependencies, root):
    """本地辅助实现及其相邻测试统一采用 3，并继续跟踪测试依赖。"""
    for path in dependencies:
        scope.setdefault(path.relative_to(root).as_posix(), 3)
        adjacent = path.with_name(f'test_{path.stem.removeprefix("test_")}.py')
        if adjacent.is_file():
            scope.setdefault(adjacent.relative_to(root).as_posix(), 3)


def main():
    """逐函数输出测量结果，任何扫描错误或超限均以非零状态结束。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='store_true')
    arguments = parser.parse_args()
    report = scan()
    invalid = engine.violations(report)
    if arguments.report:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f'E2E 代理复杂度：{len(report)} 个函数，{len(invalid)} 个超限。')
    for item in invalid:
        print(f'{item["file"]}:{item["line"]}:{item["column"]} {item["name"]}: '
              f'复杂度 {item["complexity"]}（上限 {item["limit"]}）', file=sys.stderr)
    return int(bool(invalid))


if __name__ == '__main__':
    sys.exit(main())

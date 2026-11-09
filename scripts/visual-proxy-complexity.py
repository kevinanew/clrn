"""独立检查 issue 109 的视觉代理、回放及其测试支持函数。"""

import argparse
import ast
import json
from pathlib import Path
import runpy
import sys

ROOT = Path(__file__).resolve().parent.parent
SHARED = runpy.run_path(str(Path(__file__).with_name('python-tool-complexity.py')))
MODULES = {
    'club': ('addon', 'joined_clubs', 'test_addon'),
    'game-record': ('addon', 'data', 'test_addon'),
    'texas-holdem': ('addon', 'game_log', 'records_v2', 'room_profile', 'room_view',
                     'test_addon', 'test_records_v2', 'test_room_profile', 'test_room_view',
                     'test_texas_replay', 'test_ui_states', 'test_virtual_player_preflight',
                     'texas_replay', 'ui_states', 'virtual_player_preflight'),
    'zhajinhua': ('addon', 'test_addon', 'test_zhajinhua_replay', 'zhajinhua_replay'),
}


def initial_scope(root):
    """固定必需文件，并包含任务目录中新增的任意命名 Python 实现。"""
    scope = {}
    for case, modules in MODULES.items():
        directory = Path('visual/cases') / case / 'mitmproxy'
        scope.update({(directory / f'{name}.py').as_posix(): 3 for name in modules})
        scope.update({path.relative_to(root).as_posix(): 3 for path in (root / directory).rglob('*.py')})
    scope['visual/cases/replay_transport.py'] = 3
    scope['visual/cases/fixture_protocol.py'] = 3
    scope['scripts/visual-proxy-complexity.py'] = 6
    scope['scripts/test_visual_proxy_complexity.py'] = 3
    return scope


def read_scope(root, scope):
    """递归扫描本地提取模块；缺文件和语法错误直接失败。"""
    trees = {}
    pending = list(scope)
    while pending:
        filename = pending.pop()
        path = root / filename
        tree = ast.parse(path.read_text(encoding='utf-8'), filename=filename)
        trees[filename] = tree
        for dependency in SHARED['local_dependencies'](tree, path, root):
            name = dependency.relative_to(root).as_posix()
            if name not in scope:
                scope[name] = 3
                pending.append(name)
    return trees


def scan(root=ROOT):
    """按函数独立测量；断言不计分，空扫描不得成功。"""
    scope = initial_scope(root)
    trees = read_scope(root, scope)
    report = []
    for filename, tree in sorted(trees.items()):
        report.extend(SHARED['measurements'](tree, filename, scope[filename]))
    if not report:
        raise ValueError('视觉代理复杂度扫描为空')
    return report


def main():
    """输出完整逐函数 JSON 或门禁结果，超限返回非零退出码。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='store_true')
    options = parser.parse_args()
    report = scan()
    invalid = SHARED['violations'](report)
    if options.report:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f'视觉代理复杂度：{len(report)} 个函数，{len(invalid)} 个超限。')
    for item in invalid:
        print(f'{item["file"]}:{item["line"]}:{item["column"]} {item["name"]}: '
              f'复杂度 {item["complexity"]}（上限 {item["limit"]}）', file=sys.stderr)
    return int(bool(invalid))


if __name__ == '__main__':
    sys.exit(main())

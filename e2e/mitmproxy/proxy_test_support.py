"""代理测试共用的协议解码和事件选择，不改变被测断言。"""

import json


def json_lines(text):
    """按原始顺序解析逐行 JSON。"""
    return [json.loads(line) for line in text.splitlines()]


def event_names(events):
    """提取事件类型并保留顺序。"""
    return [event['event'] for event in events]


def events_named(events, name):
    """选择指定类型的全部事件。"""
    return [event for event in events if event['event'] == name]


def field_values(events, key):
    """保留事件顺序提取字段。"""
    return [event[key] for event in events]


def instances(values, kind):
    """保留指定事件或命令类型及原顺序。"""
    return [value for value in values if isinstance(value, kind)]


def event_objects(commands, kind):
    """提取指定代理命令包裹的事件。"""
    return [command.event for command in commands if isinstance(command, kind)]


def occupied_count(seats):
    """统计非空玩家座位。"""
    return sum(seat['player'] is not None for seat in seats)


def occupied_players(seats):
    """提取占用座位玩家编号。"""
    return [seat['player']['player_id'] for seat in seats if seat['player']]

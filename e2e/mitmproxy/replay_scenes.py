"""牌桌回放的固定数据和少量具名变体；控制端不能上传任意消息。"""

import copy
import json
from datetime import datetime, timezone
from pathlib import Path

from replay_table import (CARDS, STREETS, INITIAL_BETS, initial_queue,
                          texas_table, zhajinhua_table)

DATA = Path(__file__).with_name('data')


def load(game, name):
    """读取指定玩法的 JSON 重放模板。"""
    return json.loads((DATA / f'{game}-{name}.json').read_text())


def table(game, self_id, parameters):
    """根据玩法、当前玩家与参数构造运行中的牌桌重放状态。"""
    operating = {'player_id': '@self', 'remain_operating_seconds': 120,
                 'valid_bets': copy.deepcopy(INITIAL_BETS[game])}
    value = {'stream': 'texas_holdem' if game == 'texas' else game,
             'queue': initial_queue(game, load(game, 'table'), operating)}
    {'texas': texas_table, 'zhajinhua': zhajinhua_table}[game](value, operating, parameters)
    return replace(value, {'@self': self_id})


def replace(value, values):
    """递归替换嵌套模板中的占位值，保留字典与列表结构。"""
    if isinstance(value, dict):
        return replace_mapping(value, values)
    return replace_sequence(value, values)


def replace_mapping(value, values):
    """替换字典值，保持原有键。"""
    return {key: replace(item, values) for key, item in value.items()}


def replace_sequence(value, values):
    """替换列表元素，标量交由占位符处理。"""
    if isinstance(value, list):
        return [replace(item, values) for item in value]
    return replace_scalar(value, values)


def replace_scalar(value, values):
    """仅字符串参与占位符替换。"""
    return values.get(value, value) if isinstance(value, str) else value


def validate_owner(game, self_id):
    """限制已登记玩法及非空字符串归属。"""
    if game not in ('texas', 'zhajinhua'):
        raise ValueError('Unknown game or owner')
    if not all((isinstance(self_id, str), self_id)):
        raise ValueError('Unknown game or owner')


def validate_command(command):
    """控制端只能选择具名场景及受限参数。"""
    if not isinstance(command, dict):
        raise ValueError('Only named replay scenes are accepted')
    if not set(command) <= {'scene', 'parameters'}:
        raise ValueError('Only named replay scenes are accepted')
    parameters = command.get('parameters', {})
    validate_parameter_types(parameters)
    return command.get('scene'), parameters


def validate_parameter_types(parameters):
    """参数必须是字符串值字典。"""
    if not isinstance(parameters, dict):
        raise ValueError('Invalid parameters')
    if not string_parameters(parameters):
        raise ValueError('Invalid parameters')


def countdown(value):
    """仅修改实时操作期限，保留剩余时间快照。"""
    for event in value['queue']:
        if event['event'] in ('room_status', 'game_status'):
            event['status']['operating_seconds'] = 12


def live_scene(game, self_id, name, parameters):
    """恢复、倒计时和运行中房间共用牌桌快照。"""
    if name != 'restore' and parameters:
        raise ValueError('This scene has no parameters')
    value = table(game, self_id, parameters)
    apply_live_scene(value, name)
    return value


def apply_live_scene(value, name):
    """按具名场景调整队列。"""
    if name == 'countdown':
        countdown(value)
    elif name == 'room-running':
        value['queue'] = value['queue'][:1]


def required_parameters(raw):
    """由模板占位符确定精确参数集合。"""
    tokens = (('@street', 'street'), ('@cards', 'street'), ('@action', 'action'), ('@file', 'file'))
    return {key for token, key in tokens if token in raw}


def validate_asset(action, file):
    """只允许登记的表情及道具文件。"""
    allowed = {'sticker': {'angry', 'cry', 'drink', 'puchi', 'titter', 'smirk', 'handclap'},
               'props': {'tomato', 'tea', 'water', 'flower', 'heart', 'good', 'beer'}}
    if action not in allowed or file not in allowed[action]:
        raise ValueError('Unknown asset')


def validate_action(raw, action, file):
    """资产场景验证文件，下注场景限制动作。"""
    if '@file' in raw:
        validate_asset(action, file)
        return
    if not any((action is None, action in ('call', 'raise', 'check', 'fold'))):
        raise ValueError('Unknown action')


def catalog_parameters(raw, parameters):
    """校验模板所需参数和街道枚举。"""
    if set(parameters) != required_parameters(raw):
        raise ValueError('Invalid scene parameters')
    street = parameters.get('street')
    if not any((street is None, street in ('flop', 'turn', 'river'))):
        raise ValueError('Unknown street')
    validate_action(raw, parameters.get('action'), parameters.get('file'))


def catalog_scene(game, self_id, name, parameters):
    """从只读模板构造绑定本人及参数的事件。"""
    catalog = load(game, 'replay')
    if not isinstance(name, str) or name not in catalog:
        raise ValueError('Unknown replay scene')
    value = catalog[name]
    catalog_parameters(json.dumps(value), parameters)
    return replace(value, replacement_values(self_id, parameters))


def replacement_values(self_id, parameters):
    """将已验证的参数转换为模板值。"""
    street = parameters.get('street')
    return {'@self': self_id, '@street': street, '@cards': CARDS[:STREETS[street]] if street else [],
            '@action': parameters.get('action'), '@file': parameters.get('file')}


def replay_scene(game, command, self_id):
    """校验重放指令并生成绑定当前玩家的指定玩法场景。"""
    validate_owner(game, self_id)
    name, parameters = validate_command(command)
    build = live_scene if name in ('restore', 'countdown', 'room-running') else catalog_scene
    value = build(game, self_id, name, parameters)
    if 'queue' in value:
        value['sent_at'] = datetime.now(timezone.utc).isoformat()
    return value


def channel_owners(channels, prefix):
    """仅提取当前玩法和房间频道的归属。"""
    return {channel.rsplit('#', 1)[-1] for channel in channels if channel.startswith(prefix)}


def live_owners(subscriptions, prefix):
    """合并仍存活连接上的已确认房间归属。"""
    owners = set()
    for flow, channels in subscriptions.values():
        if flow.websocket.timestamp_end is None:
            owners.update(channel_owners(channels, prefix))
    return owners


def confirmed_owner(replay, room_id, game):
    """同一房间必须且只能有一个已确认的存活归属。"""
    stream = 'texas_holdem' if game == 'texas' else game
    owners = live_owners(replay.subscriptions, f'{stream}>{room_id}#')
    if len(owners) != 1:
        raise ValueError('Expected one confirmed room owner')
    return owners.pop()


def publish_scene(replay, room_id, command, game):
    """先确认真实订阅和用户，再生成消息；保留原有发布方向、队列和房间隔离。"""
    owner = confirmed_owner(replay, room_id, game)
    if replay.self_id and replay.self_id != owner:
        raise ValueError('Another user owns this replay')
    replay.publish(room_id, replay_scene(game, command, owner))


def string_parameters(parameters):
    """逐项检查参数值类型。"""
    return all(isinstance(value, str) for value in parameters.values())

"""战绩列表夹具只读摘要；不保存账号、游标正文或记录内容。"""


def observe_list(history, path, query, mode, fixture):
    """记录有界模式与分页摘要；诊断异常不能影响原请求。"""
    try:
        if not path.endswith(('/game_records', '/recent')):
            return
        history.append({'mode': mode, 'nextPage': bool(query.get('next_page')),
                        'items': len(fixture.get('items', fixture.get('records', []))),
                        'hasNextPage': bool(fixture.get('next_page'))})
        del history[:-30]
    except Exception:
        pass

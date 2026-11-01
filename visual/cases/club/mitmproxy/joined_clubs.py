"""提供仅供已加入列表截图使用的三个虚拟俱乐部，不关联真实成员或牌局。"""

JOINED_CLUBS = [
    {
        'id': f'00000000-0000-4000-8000-000000000{number}',
        'club_no': number, 'name': name, 'member_count': members, 'avatar_path': '',
        'owner': {'id': 'visual-club-owner', 'role': 'owner'},
        'owner_id': 'visual-club-owner', 'admin_ids': [],
        'create_room_role': ['owner'], 'created_at': '2026-01-01T00:00:00Z',
    }
    for number, name, members in [
        (161, '星光俱乐部', 18),
        (162, '周末俱乐部', 36),
        (163, '好友俱乐部', 72),
    ]
]
JOINED_CLUB_IDENTIFIERS = [club['id'] for club in JOINED_CLUBS]

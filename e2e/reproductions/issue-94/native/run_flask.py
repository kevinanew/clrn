import json
import os
from pathlib import Path
import sys

def main():
    """Configure localhost dependencies before importing the unmodified service factory."""
    root = Path(os.environ['ISSUE94_NATIVE_ROOT'])
    role = sys.argv[1]
    if role not in ('texas', 'gateway', 'room', 'buyin', 'matching'):
        raise SystemExit('Unsupported isolated service')
    state = json.loads((root / 'infrastructure.json').read_text())
    keys = json.loads((root / 'centrifugo-config.json').read_text())
    os.environ.update(
        STAGE='staging', SENTRY_DSN='', AWS_EC2_METADATA_DISABLED='true',
        CENTRIFUGO_URL=f"http://127.0.0.1:{state['centrifugoPort']}",
        CENTRIFUGO_API_KEY=keys['api_key'],
        REDIS_STARTUP_NODES=json.dumps([{'host': '127.0.0.1', 'port': state['redisPorts'][0]}]),
        REDIS_PASSWORD='',
        GATEWAY_ROUTER_HOST=f"http://127.0.0.1:{state['routerPort']}",
        HTTP_PROXY=f"http://127.0.0.1:{state['routerPort']}",
        HTTPS_PROXY=f"http://127.0.0.1:{state['routerPort']}",
        http_proxy=f"http://127.0.0.1:{state['routerPort']}",
        https_proxy=f"http://127.0.0.1:{state['routerPort']}",
        NO_PROXY='127.0.0.1,localhost', no_proxy='127.0.0.1,localhost',
    )
    source = root / 'sources' / role / 'src'
    os.chdir(source)
    sys.path.insert(0, str(source))
    output = sys.stdout
    fd = os.open(root / 'logs' / (role + ('-' + sys.argv[2] + ('-' + sys.argv[3] if len(sys.argv)>3 else '') if len(sys.argv)>2 else '') + '.log'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    log = os.fdopen(fd, 'w', buffering=1)
    sys.stdout = log
    sys.stderr = log
    import configs
    # 配置边界：关闭外部遥测，服务实现、SDK、消息转换和异常处理保持原样。
    configs.Config.SENTRY_DSN = None
    configs.Staging.SENTRY_DSN = None
    for config in [configs.Config, configs.Staging]:
        config.REDIS_STARTUP_NODES = [{'host': '127.0.0.1', 'port': state['redisPorts'][0]}]
        config.CENTRIFUGO_URL = os.environ['CENTRIFUGO_URL']
        config.CENTRIFUGO_URL_V2 = os.environ['CENTRIFUGO_URL']
        config.CENTRIFUGO_API_KEY = keys['api_key']
    from apps.base import create_app
    app = create_app('staging')
    print(json.dumps({'starting': role, 'port': state[role + 'Port']}), file=output, flush=True)
    if len(sys.argv) > 2:
        import runpy
        module = sys.argv[2]
        allowed = ['end_ready_phase_later_projector', 'begin_play_later_projector', 'next_game_later_projector', 'operate_later_projector']
        assert role == 'texas' and module in allowed
        sys.argv = [module] + sys.argv[3:]
        runpy.run_module('delay_task.projector.' + module, run_name='__main__')
    else:
        app.run(host='127.0.0.1', port=state[role + 'Port'], threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()

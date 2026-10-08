FROM mcr.microsoft.com/playwright:v1.61.1-jammy

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
COPY e2e/mitmproxy/requirements.txt /tmp/mitmproxy-requirements.txt

WORKDIR /repo/visual

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV MITMDUMP_PATH=/opt/mitmproxy/bin/mitmdump

RUN corepack enable \
    && corepack prepare pnpm@11.13.0 --activate \
    && apt-get update \
    && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

RUN uv venv --python 3.12 /opt/mitmproxy \
    && uv pip install --python /opt/mitmproxy/bin/python -r /tmp/mitmproxy-requirements.txt

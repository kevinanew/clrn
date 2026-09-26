FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /repo/visual

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
    && corepack prepare pnpm@11.13.0 --activate \
    && apt-get update \
    && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

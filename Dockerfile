# TPAM: multi-user web service. Build: docker compose build   (see docs/DEPLOY.md)
FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=ui /ui/dist /app/frontend/dist
RUN useradd --system --uid 10001 tpam && mkdir /data && chown tpam /data
USER tpam
ENV TPAM_DATA_DIR=/data TPAM_HOST=0.0.0.0 TPAM_OPEN_BROWSER=false TPAM_FRONTEND_DIST=/app/frontend/dist
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8765/api/health')" || exit 1
CMD ["/app/backend/.venv/bin/tpam"]

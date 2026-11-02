# Image minimale — Carnet de Trading (aucune dépendance tierce)
# Utilisée pour un hébergement permanent simple (Render, Fly, Docker local).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    CARNET_HOST=0.0.0.0 \
    CARNET_PORT=8080 \
    CARNET_ENV=SIMULATION \
    CARNET_ALLOW_REAL=0 \
    CARNET_SIM_24_7=1

WORKDIR /app

COPY backend ./backend
COPY web ./web
COPY scripts ./scripts
COPY docs ./docs
COPY README.md ./

RUN useradd --create-home --uid 10001 carnet \
    && mkdir -p data var/backups \
    && chown -R carnet:carnet /app data var \
    && chmod 700 data var

USER carnet
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4).status == 200 else 1)"

# PORT est fourni par l'hébergeur (Render/Fly) ; 8080 par défaut.
CMD ["sh", "-c", "exec python -m carnet.server --host 0.0.0.0 --port ${PORT:-8080}"]

# syntax=docker/dockerfile:1
FROM python:3.12-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv

RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

WORKDIR /build

RUN pip install --upgrade pip poetry

COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root

# Runtime stage
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    WORK_DIR="/tmp/kiru-worker" \
    HF_HOME="/home/kiru/.cache/huggingface"

# Install ffmpeg with libx264, libass, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 -U kiru && \
    mkdir -p /tmp/kiru-worker /home/kiru/.cache/huggingface /app && \
    chown -R kiru:kiru /tmp/kiru-worker /home/kiru /app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=kiru:kiru pyproject.toml ./
COPY --chown=kiru:kiru src ./src

# Install package itself in the venv
RUN pip install --no-deps -e .

USER kiru

ENTRYPOINT ["kiru-worker"]
CMD ["doctor"]

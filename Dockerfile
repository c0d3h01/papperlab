# syntax=docker/dockerfile:1

FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/paperlab ./cmd/server

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-noto-core \
    ghostscript \
    libreoffice \
    poppler-utils \
    qpdf \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-osd \
    chromium \
  && rm -rf /var/lib/apt/lists/*

ENV PAPERLAB_ADDR=:8080 \
    PAPERLAB_WEB_DIR=/app/web \
    PAPERLAB_DATA_DIR=/data \
    PAPERLAB_SERVE_WEB=0 \
    PAPERLAB_CHROME_PATH=/usr/bin/chromium \
    PAPERLAB_LIBREOFFICE_PATH=/usr/bin/libreoffice \
    HOME=/data

WORKDIR /app
COPY --from=build /out/paperlab /usr/local/bin/paperlab
COPY web ./web
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
RUN mkdir -p /data && chown 10001:10001 /data
USER 10001:10001

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

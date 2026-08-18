FROM ghcr.io/home-assistant/base:latest

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}" \
    org.opencontainers.image.title="Home Assistant App: Receipt Printer" \
    org.opencontainers.image.description="Multi-printer template rendering and job API for Home Assistant" \
    org.opencontainers.image.source="https://github.com/Jesseadamwilson/receipt-printer"

ENV LANG=C.UTF-8
ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

RUN apk add --no-cache \
    nodejs \
    npm \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont

WORKDIR /app

COPY app/package.json /app/package.json
COPY app/package-lock.json /app/package-lock.json
RUN npm ci --omit=dev

COPY app /app
COPY run.sh /run.sh

RUN chmod a+x /run.sh

EXPOSE 8099

CMD ["/run.sh"]

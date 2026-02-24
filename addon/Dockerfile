ARG BUILD_FROM
FROM ${BUILD_FROM}

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
RUN npm install --omit=dev

COPY app /app
COPY run.sh /run.sh

RUN chmod a+x /run.sh

EXPOSE 8099

CMD ["/run.sh"]

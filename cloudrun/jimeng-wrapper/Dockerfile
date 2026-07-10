FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bash \
  && rm -rf /var/lib/apt/lists/* \
  && curl -s https://jimeng.jianying.com/cli | bash \
  && (command -v dreamina || find /root -type f -name dreamina -perm /111 -exec ln -sf {} /usr/local/bin/dreamina \; -quit)

COPY package.json ./
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]

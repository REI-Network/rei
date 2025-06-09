FROM node:22-alpine3.18

RUN apk update &&apk add build-base python3

ENV DOCKER_BUILDING=1
WORKDIR /app

COPY package*.json ./
COPY exported-package-json ./packages
RUN npm i -g typescript@^4.1.2 && npm ci --omit=dev

COPY . .
RUN npm run build -ws

VOLUME /datadir

# RPC Port
EXPOSE 11451
# P2P TCP Port
EXPOSE 4191
# P2P UDP Port
EXPOSE 9810/udp

ENTRYPOINT ["npx", "rei", "--datadir", "/datadir", "--sync", "snap", "--rpc", "--rpc-host", "0.0.0.0"]
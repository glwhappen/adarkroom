# 篝火（A Dark Room 多人版）—— 静态游戏 + Fastify 服务端同一个镜像
FROM node:24-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# 再拷游戏本体与服务端代码
COPY . .

ENV NODE_ENV=production \
    PORT=4401 \
    STATIC_ROOT=/app/

EXPOSE 4401
WORKDIR /app/server
CMD ["node", "src/index.js"]

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/logs && touch /app/logs/bot.log && chmod 666 /app/logs/bot.log

ENV TZ=Europe/Kyiv
ENV NODE_ENV=production

CMD ["node", "mono-exchange.js"]

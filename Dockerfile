FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000 6454 6454/udp 5568 5568/udp

CMD ["node", "src/index.js"]

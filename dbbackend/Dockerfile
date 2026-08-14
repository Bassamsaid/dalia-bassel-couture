FROM node:22-alpine
WORKDIR /app
COPY dbbackend/ ./
CMD ["node", "--experimental-sqlite", "server.js"]

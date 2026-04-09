FROM docker.io/node:22-alpine AS base
WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

EXPOSE 8000
CMD ["npm", "run", "start"]

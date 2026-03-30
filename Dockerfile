FROM node:22.14.0

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:web

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]

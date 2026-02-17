FROM node:20-alpine

WORKDIR /app

COPY services/calling-service/package*.json ./
RUN npm install

COPY packages/shared/prisma ./prisma/
RUN npx prisma generate

COPY services/calling-service/ .

EXPOSE 4005

CMD ["npm", "run", "dev"]

FROM node:20-alpine

WORKDIR /app

COPY services/order-tracking-service/package*.json ./
RUN npm install

COPY packages/shared/prisma ./prisma/
RUN npx prisma generate

COPY services/order-tracking-service/ .

EXPOSE 4007

CMD ["npm", "run", "dev"]

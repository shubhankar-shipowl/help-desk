FROM node:20-alpine

WORKDIR /app

COPY services/facebook-service/package*.json ./
RUN npm install

COPY packages/shared/prisma ./prisma/
RUN npx prisma generate

COPY services/facebook-service/ .

EXPOSE 4006

CMD ["npm", "run", "dev"]

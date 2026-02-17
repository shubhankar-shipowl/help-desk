FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY services/notification-service/package*.json ./
RUN npm install

# Copy shared prisma schema and generate client
COPY packages/shared/prisma ./prisma/
RUN npx prisma generate

# Copy application files
COPY services/notification-service/ .

# Expose port
EXPOSE 4004

# Start the application
CMD ["npm", "run", "dev"]

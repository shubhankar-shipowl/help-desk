FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY services/email-service/package*.json ./
RUN npm install

# Copy shared prisma schema and generate client
COPY packages/shared/prisma ./prisma/
RUN npx prisma generate

# Copy application files
COPY services/email-service/ .

# Expose port
EXPOSE 3003

# Start the application
CMD ["npm", "run", "dev"]

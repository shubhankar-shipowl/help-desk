FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy shared prisma schema and generate client
COPY packages/shared/prisma ./prisma/
RUN npx prisma generate

# Copy application files
COPY frontend/ .

# Expose port
EXPOSE 4002

# Start the application
CMD ["npm", "run", "dev"]

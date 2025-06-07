FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY functions/package*.json ./functions/

# Install dependencies
RUN npm ci
RUN cd functions && npm ci

# Copy source code
COPY . ./

# Build TypeScript
RUN npm run build

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["npm", "start"] 
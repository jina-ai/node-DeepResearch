# ---- BUILD STAGE ----
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --ignore-scripts

# Copy application code
COPY . .

# Build the application
RUN npm run build --ignore-scripts

# ---- PRODUCTION STAGE ----
FROM node:20-slim AS production

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies only
RUN npm install --production  --ignore-scripts

# Copy config.json and built files from builder
COPY --from=builder /app/config.json ./
COPY --from=builder /app/dist ./dist

# Set environment variables (Recommended to set at runtime, avoid hardcoding)
ENV GEMINI_API_KEY=${GEMINI_API_KEY}
ENV OPENAI_API_KEY=${OPENAI_API_KEY}
ENV JINA_API_KEY=${JINA_API_KEY}
ENV BRAVE_API_KEY=${BRAVE_API_KEY}

# Expose the port the app runs on
EXPOSE 3000

# Set startup command
CMD ["node", "./dist/server.js"]

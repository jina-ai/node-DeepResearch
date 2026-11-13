# ---- BUILD STAGE ----
FROM node:24-slim AS builder

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY ./package*.json ./
COPY ./jina-ai/package*.json ./jina-ai/

# Install dependencies
RUN npm ci
WORKDIR /app/jina-ai
RUN npm ci

WORKDIR /app

# Copy application code
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json
COPY ./jina-ai/config.json ./
RUN npm run build

COPY ./jina-ai/src ./jina-ai/src
COPY ./jina-ai/tsconfig.json ./jina-ai/tsconfig.json
WORKDIR /app/jina-ai
RUN npm run build

# ---- PRODUCTION STAGE ----
FROM node:24 AS production

# Set working directory
WORKDIR /app

COPY --from=builder /app ./
# Copy config.json and built files from builder

WORKDIR /app/jina-ai

# Set environment variables (Recommended to set at runtime, avoid hardcoding)
ENV GEMINI_API_KEY=${GEMINI_API_KEY}
ENV OPENAI_API_KEY=${OPENAI_API_KEY}
ENV JINA_API_KEY=${JINA_API_KEY}
ENV BRAVE_API_KEY=${BRAVE_API_KEY}

# Expose the port the app runs on
EXPOSE 3000

# Set startup command
CMD ["node", "./dist/server.js"]

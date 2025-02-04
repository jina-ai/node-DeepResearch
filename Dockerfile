# Use Node.js 20 as the base image
FROM node:20

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the application code
COPY . .

# Set environment variables
ENV GEMINI_API_KEY=${GEMINI_API_KEY}
ENV JINA_API_KEY=${JINA_API_KEY}
ENV BRAVE_API_KEY=${BRAVE_API_KEY}

# Build the application
RUN npm run build

# Expose the port the app runs on
EXPOSE 3000

# Set the default command to run the application
CMD ["npm", "run", "serve"]

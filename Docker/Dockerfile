# Stage 0: Base context - this stage exists just to have a clean context without exclusions
FROM alpine:latest as context

# Copy everything from the build context
COPY . /build/

# Stage 1: Volume initialization
FROM alpine:latest as volume-init

# Copy only the volume directories we need
COPY Docker/volumes/pinokio/ /tmp/pinokio/
COPY Docker/volumes/pinokio-config/ /tmp/config/

# Install find utility to clean up __pycache__ directories
RUN apk add --no-cache findutils

# Remove all __pycache__ directories and .pyc files to reduce image size
RUN find /tmp -name "__pycache__" -type d -exec rm -rf {} +
RUN find /tmp -name "*.pyc" -delete

# Stage 2: Node.js dependencies
FROM node:22.14.0-alpine as node-deps

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 3: Main application
FROM nvidia/cuda:12.2.2-base-ubuntu22.04

# Install necessary packages (minimized)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    xvfb \
    findutils \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set up X Virtual Framebuffer
ENV DISPLAY=:99
RUN Xvfb :99 -screen 0 1920x1080x24 &

# Install Node.js
ENV NODE_VERSION 22.14.0
RUN curl -fsSLO --compressed "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" \
    && tar -xJf "node-v$NODE_VERSION-linux-x64.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
    && rm "node-v$NODE_VERSION-linux-x64.tar.xz" \
    && ln -s /usr/local/bin/node /usr/local/bin/nodejs

# Set the working directory
WORKDIR /app

# Copy only the necessary application files
COPY .dockerignore ./
COPY .gitignore ./
COPY *.js ./
COPY *.json ./
COPY LICENSE ./
COPY server/ ./server/
COPY pipe/ ./pipe/
COPY script/ ./script/
COPY kernel/ ./kernel/
COPY Docker/.bashrc ./Docker/.bashrc

# Copy node modules from the dependency stage
COPY --from=node-deps /app/node_modules ./node_modules

# Create directories for volumes
RUN mkdir -p /root/pinokio
RUN mkdir -p /root/config

# Copy volume contents from the volume-init stage
# Note: These volumes have already been cleaned of __pycache__ and .pyc files
COPY --from=volume-init /tmp/pinokio/ /root/pinokio/
COPY --from=volume-init /tmp/config/ /root/config/

# Create pinokio.json file in the script directory with the home directory set
RUN echo '{"home": "/root/pinokio"}' > /root/config/pinokio.json

RUN ln -s /root/config/pinokio.json /app/script/pinokio.json

COPY Docker/.bashrc /root/.bashrc

# Expose the port that the application will run on
EXPOSE 41999

# Patch server script to not display in window
RUN sed -i '1s|^|global.window = global.window \|\| {}; global.window.location = { href: \"http://localhost\" }; \n|' /app/script/index.js

# Set environment variables
ENV HOME=/root
ENV PINOKIO_HOME=/root/pinokio
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]


# QuantaPool Oracle Docker Image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (for layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/ ./src/

# Create non-root user
RUN addgroup -S oracle && adduser -S oracle -G oracle
RUN mkdir -p /var/log/quantapool-oracle && chown -R oracle:oracle /var/log/quantapool-oracle
USER oracle

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node src/status.js || exit 1

# Run oracle
CMD ["node", "src/index.js"]

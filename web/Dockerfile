# =====================================================================
# web/Dockerfile — React + Vite SPA Production Build with Nginx
# Multi-stage build: Node 20 build -> Nginx 1.27 Alpine runtime
# =====================================================================

# Stage 1: Build static bundle
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Exclude unchanging 202 MB public/media from /app/dist so Stage 2 caches it as a
# shared base layer across commits instead of creating a new 212 MB layer per deploy.
RUN rm -rf /app/public/media && npm run build

# Stage 2: Serve static bundle + reverse proxy /api via Nginx
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/media /usr/share/nginx/html/media
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget -q --spider http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

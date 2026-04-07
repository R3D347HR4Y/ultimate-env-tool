# Ultimate Env Tool — static SPA for CapRover (or any Docker host)
# CapRover: captain-definition at repo root sets dockerfilePath → this file.
#
# Build with your public URL so SEO (canonical, OG, sitemap) is correct:
#   docker build --build-arg VITE_SITE_URL=https://env.example.captain.domain -t ultimate-env-tool .
#
# CapRover: App Config → Deployment → "Method 3: Dockerfile" → add Build Argument:
#   VITE_SITE_URL = https://your-app.yourdomain.com

FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first (better layer cache)
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json eslint.config.js ./
COPY public ./public
COPY src ./src

# Production canonical / OG URLs (if empty, build uses https://envtool.eliott.cloud)
ARG VITE_SITE_URL=
ENV VITE_SITE_URL=${VITE_SITE_URL}

RUN npm run build

# ---

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

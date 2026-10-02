FROM node:24-alpine AS build
WORKDIR /web
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL=http://localhost:8000
ARG VITE_DEV_MODE=false
ENV VITE_API_URL=$VITE_API_URL VITE_DEV_MODE=$VITE_DEV_MODE
RUN pnpm run build

FROM nginx:1.30-alpine
COPY nginx-main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run
USER nginx
EXPOSE 8080

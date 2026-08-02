# Static explorer image for Coolify: build the Vite bundle, serve with nginx.
FROM node:24-alpine AS build
WORKDIR /usr/local/src/climat-communes
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
COPY web/ web/
RUN npm run build

# nginx-unprivileged runs as the dedicated non-root "nginx" user (uid 101)
# maintained by the base image — same non-root guarantee as a bespoke uid 1000
# user, without fighting nginx's writable-path layout.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /usr/local/src/climat-communes/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080

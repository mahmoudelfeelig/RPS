FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./

ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:1.27-alpine

RUN sed -i 's@^[[:space:]]*pid[[:space:]].*;@pid /tmp/nginx.pid;@' /etc/nginx/nginx.conf \
    && grep -Fx 'pid /tmp/nginx.pid;' /etc/nginx/nginx.conf >/dev/null \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d /usr/share/nginx/html
COPY --chown=nginx:nginx frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=build /app/build /usr/share/nginx/html

EXPOSE 80
USER nginx

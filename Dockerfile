FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node attendance.mjs mail-imap.mjs mail-trash.mjs server.mjs api-http.mjs evolution.mjs email.mjs whatsapp.mjs booking.mjs bank.mjs bordero-csv.mjs openapi.json ./
COPY --chown=node:node templates/email-cobranca.json ./templates/email-cobranca.json
COPY --chown=node:node web ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]



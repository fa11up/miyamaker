FROM node:20-alpine

WORKDIR /app
COPY --chown=node:node . .

RUN mkdir -p layers build buildphase2 manualmaker edittrait \
    && chown -R node:node /app

USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]

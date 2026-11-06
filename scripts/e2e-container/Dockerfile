# Chrome + Node für die Ende-zu-Ende-Tests auf der NAS (Auftragsdienst, Zentrale 1.3.0).
# Keine Rechte, kein Docker-Zugriff – startet nur Chrome und die Testskripte gegen den Teststand.
FROM node:22-alpine
RUN apk add --no-cache chromium font-noto ttf-dejavu \
 && ln -sf "$(command -v chromium || command -v chromium-browser)" /usr/local/bin/chrome
ENV CHROME_BIN=/usr/local/bin/chrome HOME=/tmp
USER node

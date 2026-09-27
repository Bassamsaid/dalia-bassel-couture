FROM node:22-alpine
WORKDIR /app

# The dependencies, before the code. This app was dependency-free for most of
# its life — SQLite came with Node — so the image never installed anything. It
# has a database client now, and a build that skips this step produces a
# container that starts, fails to find the client, and exits.
#
# Copying the manifest on its own first means a change to the app's own files
# rebuilds from here without downloading the same packages again.
COPY package*.json ./
RUN npm install --omit=dev

COPY . ./
CMD ["node", "server.js"]

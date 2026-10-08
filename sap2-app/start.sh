#!/bin/sh
# Mac / Linux launcher: ./start.sh  (or double-click start.sh after: chmod +x start.sh)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org then run this again."; exit 1
fi
[ -d node_modules ] || { echo "Installing SAP2 for the first time, please wait..."; npm install || exit 1; }
if [ ! -f .env ]; then
  echo "===== First-time setup ====="
  echo "In Neon: open project sap2, click Connect, copy the POOLED connection string (starts with postgresql://)."
  printf "Paste it here and press Enter: "; read DB
  printf 'DATABASE_URL=%s\nPORT=3000\n' "$DB" > .env
fi
echo "Starting SAP2. Keep this window open while you use the app."
( sleep 3; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 ) &
npm start

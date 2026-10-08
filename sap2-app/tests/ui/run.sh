#!/usr/bin/env bash
# Starts a fresh mock server, runs the browser test, stops the server.
cd "$(dirname "$0")/../.." || exit 1
PORT=${PORT:-3199}
node tests/ui/mock-server.js "$PORT" >/tmp/sap2-mock.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -s "localhost:$PORT/api/health" >/dev/null && break; sleep 0.3; done
BASE="http://localhost:$PORT" node tests/ui/ui.test.js

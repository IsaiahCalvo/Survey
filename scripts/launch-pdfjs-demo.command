#!/bin/zsh

# Canonical Survey PDF.js demo launcher.
# AI reference: the experience starts in src/prototype/FeatureSpike.jsx.
# PDF and annotation rendering live in src/prototype/PdfjsArm.jsx and
# src/prototype/CanvasAnnotationLayer.jsx. The canonical route is ?spike=features.

set -u

SCRIPT_PATH="${0:A}"
SCRIPT_DIR="${SCRIPT_PATH:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
HOST="127.0.0.1"
START_PORT="${PDFJS_DEMO_START_PORT:-5178}"
LAST_PORT=$((START_PORT + 99))
ROUTE="/?spike=features"
STATE_DIR="$HOME/Library/Application Support/Survey PDF.js Demo"
PID_FILE="$STATE_DIR/server.pid"
PORT_FILE="$STATE_DIR/server.port"
LOG_FILE="$HOME/Library/Logs/Survey-PDFjs-Demo.log"

fail() {
  print -u2 "PDF.js Demo: $1"
  print -u2 "Log: $LOG_FILE"
  exit 1
}

port_in_use() {
  /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

health_check() {
  /usr/bin/curl --fail --silent --max-time 1 --output /dev/null \
    "http://$HOST:$1$ROUTE"
}

project_server_pid() {
  local port="$1"
  local pids
  local pid
  local cwd
  local resolved_cwd

  pids="$(/usr/sbin/lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | /usr/bin/sort -u)"
  for pid in ${(f)pids}; do
    cwd="$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -n 1)"
    [[ -n "$cwd" ]] || continue
    resolved_cwd="$(cd "$cwd" 2>/dev/null && pwd -P)" || continue
    if [[ "$resolved_cwd" == "$PROJECT_DIR" ]]; then
      print "$pid"
      return 0
    fi
  done

  return 1
}

open_demo() {
  local port="$1"
  local url="http://$HOST:$port$ROUTE"

  if [[ "${PDFJS_DEMO_NO_OPEN:-0}" != "1" ]]; then
    /usr/bin/open -a "Google Chrome" "$url" >/dev/null 2>&1 || /usr/bin/open "$url"
  fi

  print "PDF.js demo ready: $url"
  print "Launcher: $SCRIPT_PATH"
  print "Demo source: $PROJECT_DIR/src/prototype/FeatureSpike.jsx"
}

mkdir -p "$STATE_DIR" "${LOG_FILE:h}"

# Reuse the last server only when it still belongs to this project.
if [[ -r "$PID_FILE" && -r "$PORT_FILE" ]]; then
  saved_pid="$(<"$PID_FILE")"
  saved_port="$(<"$PORT_FILE")"
  if [[ "$saved_pid" == <-> && "$saved_port" == <-> ]] \
    && /bin/kill -0 "$saved_pid" 2>/dev/null \
    && [[ "$(project_server_pid "$saved_port" 2>/dev/null)" == "$saved_pid" ]] \
    && health_check "$saved_port"; then
    open_demo "$saved_port"
    exit 0
  fi
fi

# Also reuse a matching project server started outside this launcher.
for ((port = START_PORT; port <= LAST_PORT; port++)); do
  port_in_use "$port" || continue
  server_pid="$(project_server_pid "$port" 2>/dev/null)" || continue
  health_check "$port" || continue
  print "$server_pid" >| "$PID_FILE"
  print "$port" >| "$PORT_FILE"
  open_demo "$port"
  exit 0
done

VITE_BIN="$PROJECT_DIR/node_modules/.bin/vite"
[[ -x "$VITE_BIN" ]] || fail "Dependencies are missing. Run npm install in $PROJECT_DIR."
command -v node >/dev/null 2>&1 || fail "Node.js is not available in your shell."

selected_port=""
for ((port = START_PORT; port <= LAST_PORT; port++)); do
  if ! port_in_use "$port"; then
    selected_port="$port"
    break
  fi
done
[[ -n "$selected_port" ]] || fail "No free local port was found between $START_PORT and $LAST_PORT."

print "\n--- $(/bin/date '+%Y-%m-%d %H:%M:%S') starting on $HOST:$selected_port ---" >> "$LOG_FILE"
cd "$PROJECT_DIR" || fail "Project directory is unavailable: $PROJECT_DIR"
"$VITE_BIN" --host "$HOST" --port "$selected_port" --strictPort \
  >> "$LOG_FILE" 2>&1 &
server_pid=$!
print "$server_pid" >| "$PID_FILE"
print "$selected_port" >| "$PORT_FILE"

cleanup() {
  trap - HUP INT TERM EXIT
  /bin/kill "$server_pid" 2>/dev/null || true
  if [[ -r "$PID_FILE" && "$(<"$PID_FILE")" == "$server_pid" ]]; then
    /bin/rm -f "$PID_FILE" "$PORT_FILE"
  fi
}
trap cleanup HUP INT TERM EXIT

ready=0
for attempt in {1..80}; do
  if health_check "$selected_port"; then
    ready=1
    break
  fi
  /bin/kill -0 "$server_pid" 2>/dev/null || break
  /bin/sleep 0.1
done

if (( ready == 0 )); then
  /bin/kill "$server_pid" 2>/dev/null || true
  fail "The local server did not start."
fi

open_demo "$selected_port"
print "Keep this Terminal window open. Closing it stops the demo."
wait "$server_pid"

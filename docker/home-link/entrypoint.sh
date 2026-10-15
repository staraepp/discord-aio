#!/bin/sh
# Starts Tailscale, then forwards every connection on :2333 to the home node over the tailnet.
set -eu
: "${HOME_NODE_HOST:=aio-home-music}"
SOCK=/tmp/tailscaled.sock

/usr/local/bin/containerboot &
boot=$!

until tailscale --socket="$SOCK" status >/dev/null 2>&1; do
  kill -0 "$boot" 2>/dev/null || { echo "tailscale failed to start" >&2; exit 1; }
  sleep 2
done
echo "tailscale is up; forwarding :2333 to ${HOME_NODE_HOST}:2333"

socat TCP-LISTEN:2333,fork,reuseaddr EXEC:"tailscale --socket=$SOCK nc ${HOME_NODE_HOST} 2333" &
fwd=$!

# Exit (and let Docker restart us) if either process dies.
while kill -0 "$boot" 2>/dev/null && kill -0 "$fwd" 2>/dev/null; do sleep 5; done
echo "home-link stopped" >&2
exit 1

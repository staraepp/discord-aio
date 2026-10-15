# VPS side of the home music node: joins the private Tailscale network (userspace mode, no
# extra privileges) and forwards home-link:2333 to Lavalink on the home node.
FROM tailscale/tailscale:v1.102.5
RUN apk add --no-cache socat
COPY entrypoint.sh /usr/local/bin/home-link
ENTRYPOINT ["/bin/sh", "/usr/local/bin/home-link"]

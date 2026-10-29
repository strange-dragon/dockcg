# Running Dockcg behind a reverse proxy

Dockcg talks to the browser over WebSocket (socket.io), streams container logs and
terminal output through the same connection, and serves everything from one port
(`5001` by default). A reverse proxy therefore needs to forward the WebSocket
upgrade, not just plain HTTP.

If the UI keeps showing "Cannot connect to the socket server", it is almost always
one of these:

| Symptom | Cause |
|---|---|
| Page loads, status stays disconnected | proxy does not forward `Upgrade` / `Connection` headers |
| Works, but the terminal freezes after a minute | proxy read timeout too short |
| Redirect loop right after login | proxy strips or rewrites cookies, or terminates TLS while Dockcg thinks it is plain HTTP |
| `502` on long running pulls | proxy buffers or times out on long-lived streams |

## Caddy

```caddyfile
dockcg.example.com {
    reverse_proxy 127.0.0.1:5001
}
```

That is the whole config: Caddy handles the WebSocket upgrade and TLS on its own.
If Dockcg runs as another compose service, use the service name instead of the
loopback address:

```caddyfile
dockcg.example.com {
    reverse_proxy dockcg:5001
}
```

## Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name dockcg.example.com;

    ssl_certificate     /etc/letsencrypt/live/dockcg.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dockcg.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:5001;
        proxy_http_version 1.1;

        # websocket upgrade (terminal, logs, live progress)
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # long-lived streams: pulls and log tailing must not be cut off
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering    off;
    }

    # the compose terminal uses a large upload for paste
    client_max_body_size 0;
}
```

If you terminate TLS at the proxy while Dockcg still listens on plain HTTP, that is
fine — just keep `X-Forwarded-Proto` set so redirects stay on `https://`.

## Traefik

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.dockcg.rule=Host(`dockcg.example.com`)"
  - "traefik.http.routers.dockcg.entrypoints=websecure"
  - "traefik.http.routers.dockcg.tls.certresolver=letsencrypt"
  - "traefik.http.services.dockcg.loadbalancer.server.port=5001"
```

Traefik picks up the WebSocket upgrade automatically.

## Sub-path hosting

Dockcg serves absolute paths (`/assets/...`, socket.io on `/socket.io/`), so hosting
it under `https://example.com/dockcg/` needs URL rewriting on the proxy. A
dedicated subdomain is much less trouble.

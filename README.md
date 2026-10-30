<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# Dockcg

A compose-first, self-hosted stack manager for Docker — **a fork of [Dockge](https://github.com/louislam/dockge)** that keeps upstream's compose workflow and adds a **System Resources** section for the things a stack does not own by itself: images, volumes, networks and private registry credentials.

[![GitHub Repo stars](https://img.shields.io/github/stars/strange-dragon/dockcg?logo=github&style=flat)](https://github.com/strange-dragon/dockcg) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/strange-dragon/dockcg/master?logo=github)](https://github.com/strange-dragon/dockcg/commits/master/) [![License](https://img.shields.io/github/license/strange-dragon/dockcg)](./LICENSE)

![Stacks: pick a stack on the left, edit compose.yaml on the right](./docs/screenshots/stacks.png)

---

## What this fork is

Dockcg is **not** a rewrite. It is Dockge with a different scope of responsibility: Dockge manages `compose.yaml`, Dockcg manages `compose.yaml` **plus the Docker resources those files lean on**.

Everything upstream does still works the same way — the stack list, the interactive editor, the web terminal, agents, the `docker run` → compose converter. If you know Dockge, you already know Dockcg; the sidebar simply grew four tabs.

| | Dockge (upstream) | Dockcg (this fork) |
|---|---|---|
| Scope | `compose.yaml` lifecycle | `compose.yaml` **+ images / volumes / networks / registries** |
| Navigation | Stack list only | Stacks link plus four Resources tabs: Containers, Images, Volumes and Networks; registry sources appear on Home |
| Image handling | Pull/update through the stack | Inventory with in-use / unused / dangling state, pre-pull with live progress, targeted delete, prune of unused + dangling |
| Volumes | Owned silently by compose | Mountpoint, driver, scope, owning stack + service, orphan cleanup, **copy to another volume** |
| Networks | Not exposed | bridge/overlay/host inventory, **draggable relationship view**, cross-stack `external: true` snippet generator, **merge into a shared network** |
| Private registries | Not exposed | Docker Hub / ghcr.io / Harbor credentials, `docker login` in the background, password encrypted at rest |
| Language | 30+ locales | English + Simplified Chinese only (English by default) |
| Branding | `DOCKGE_*` env, `dockge.db`, `louislam/dockge` images | `DOCKCG_*` env, `dockcg.db`, `strange-dragon/dockcg` — nothing is pulled from the upstream Docker Hub namespace |
| Container | `upstream/base` + `build-healthcheck` images | One self-contained `docker/Dockerfile` (multi-stage, no upstream base image) |

**Credit where it is due:** the application, the UI language, the compose editor, the agent protocol and most of the backend are [louislam/dockge](https://github.com/louislam/dockge) under the MIT license. This fork only adds the resources module and rebrands; bugs in the core are upstream's, and so are the good ideas.

## Design boundaries

Three rules shape the whole resources module. They are enforced in code, not just in the docs.

1. **No container lifecycle outside compose.** There is no `docker run` form, no start/stop button for a bare container, no "create container" wizard. Containers are created, updated and destroyed by `docker compose up -d`, always.
2. **Declarative first.** Volumes and networks created here exist so that a `compose.yaml` can join them with `external: true`. The UI hands you that snippet instead of hiding the fact.
3. **Cleanup is targeted, never `docker prune`.** The backend computes the candidate list, removes resources one by one, and refuses anything that is still attached or owned by a compose project.

## Screenshots

These screenshots predate the network relationship view and show the previous page layout.

| Images | Volumes |
|---|---|
| ![Image detail: containers using it, layers, digest, platform](./docs/screenshots/images.png) | ![Volume detail: mountpoint, owning stack, migration](./docs/screenshots/volumes.png) |

| Networks | Stacks |
|---|---|
| ![Previous network detail](./docs/screenshots/networks.png) | ![Stack detail: containers, terminal, compose.yaml](./docs/screenshots/stacks.png) |

## Features

### Compose management (inherited from upstream)

- 🧑‍💼 Create / edit / start / stop / restart / delete `compose.yaml` stacks
- ⌨️ Interactive editor with YAML completion
- 🦦 Interactive web terminal per container, plus streaming pull/up output
- 🕷️ Multiple agents — drive several Docker hosts from one interface
- 🏪 Convert a `docker run ...` command into a `compose.yaml`
- 📙 File based — your compose files stay where they are, usable with plain `docker compose`
- 🚄 Reactive — progress and logs arrive over websockets, no polling
- 🌐 English and Simplified Chinese, English by default (`Settings → Appearance → Language`)

### System resources (added here)

**Images** — tag, size, created, resolved in-use / unused / dangling state from `com.docker.compose.project` labels, the containers that use the image, all tags sharing the same image ID, digest, platform, entrypoint, exposed ports, pre-pull with live terminal progress, targeted delete, prune of unused or dangling images.

**Volumes** — mountpoint, driver, scope, labels, owning stack + service, attached containers, generated `compose.yaml` snippet, orphan cleanup, and **migration**: the content is copied into a new empty volume by a short-lived `alpine:3` helper. The source is always kept. Update `compose.yaml` after checking the copy. Migration is refused while a container still mounts the source. Disk usage is calculated on demand.

**Networks** — driver, subnet, scope, internal flag, attached containers and a draggable relationship view. Dragging a managed service or selecting several source networks previews changes to the affected Compose files. The server validates and saves the files; deploy the stacks to apply the changes. Unmanaged services use the generated `external: true` snippet. Unused network cleanup protects names declared in managed Compose files.

**Registries** (`Home`, with management in `Settings → Registries`) — shows login source names from the Docker config visible to Dockcg and mirrors from the daemon. Source entries do not prove credentials are still valid. Saved credentials are encrypted at rest, synced with `docker login` and restored after server restart; failures can be retried with *Sync all*.

**Agent management** (`Settings → Agents`) — add, rename and remove remote Dockcg agents; this was moved from the Home page to keep Home focused.

**Container migration** (`Resources → Containers`) — scans every container and generates a Compose draft from its inspect data. The draft includes image, environment, published ports, mounts, restart policy and networks, plus review warnings. The original container is never stopped or deleted. Save the draft first and resolve port conflicts before deploying.

---

## 🔧 Installation

### Requirements

- Docker 20+ (Docker Engine with the `docker compose` plugin) or Podman
  - Podman users also need `podman-docker` (Debian/Ubuntu: `apt install podman-docker`)
- A Linux host that can run Docker:
  - ✅ Ubuntu, Debian (Bullseye+), Raspbian (Bullseye+), CentOS, Fedora, Arch Linux
  - ❌ Debian/Raspbian Buster or older, ❌ Windows (not supported)
- Architecture: `amd64` (x86_64), `arm64`, `armv7`

> The image is **not published yet**. `compose.yaml` in this repo carries a `build:` section, so the first start compiles it locally. Once you push your own image, set `image:` and delete the `build:` block.

### Quick start

Default values: stacks directory `/opt/stacks`, web port `5001`, data directory `./data`.

```bash
# 1. Directories: one for your stacks, one for Dockcg itself
mkdir -p /opt/stacks /opt/dockcg
cd /opt/dockcg

# 2. Grab the compose file
curl https://raw.githubusercontent.com/strange-dragon/dockcg/master/compose.yaml --output compose.yaml

# 3. Build and start (first run compiles the frontend and the healthcheck)
docker compose up -d --build

# Docker Compose v1 or Podman:
# docker-compose up -d --build
```

Open <http://localhost:5001> and create the admin account on first launch.

### The compose file, explained

```yaml
services:
  dockcg:
    image: strange-dragon/dockcg:1
    build:                      # remove once you publish your own image
      context: .
      dockerfile: docker/Dockerfile
      target: release
    restart: unless-stopped
    ports:
      - 5001:5001               # host:container
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # required: talks to the daemon
      - ./data:/app/data                            # database, settings, agent config
      # - /root/.docker/:/root/.docker              # optional: keep registry logins across recreations
      - /opt/stacks:/opt/stacks                     # stacks — host path MUST equal container path
    environment:
      - DOCKCG_STACKS_DIR=/opt/stacks
```

⚠️ **The stacks mount must be identical on both sides** (`/opt/stacks:/opt/stacks`). A mismatch such as `/docker:/my-stacks` makes Dockcg write to a path your `docker compose` commands cannot see. Both paths must also be **absolute**.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DOCKCG_STACKS_DIR` | `/opt/stacks` | Where stacks live inside the container. Mount the same path from the host. |
| `DOCKCG_DATA_DIR` | `/app/data` | SQLite database, settings, agent list. Mount it or you lose your config on recreate. |
| `DOCKCG_PORT` | `5001` | HTTP port inside the container. Change the left side of `ports:` to move it on the host. |
| `DOCKCG_HOSTNAME` | auto | Value shown in the UI/healthcheck. Set it when you access Dockcg through a hostname. |
| `DOCKCG_SSL_KEY` / `DOCKCG_SSL_CERT` / `DOCKCG_SSL_KEY_PASSPHRASE` | — | Serve HTTPS directly instead of hiding behind a reverse proxy. |
| `DOCKCG_ENABLE_CONSOLE` | `true` | Set to `false` to hide the global console/terminal. |
| `DOCKCG_HIDE_LOG` | — | `1` silences the timestamp/level prefix in logs. |
| `PUID` / `PGID` | `root` | Ownership applied to stack files. **Both** must be set to take effect. |
| `TZ` | container default | Timezone for log timestamps, e.g. `Asia/Shanghai`. |

### Behind a reverse proxy

Caddy, nginx and Traefik configurations (websocket upgrade included) live in [docs/reverse-proxy.md](./docs/reverse-proxy.md). The short version: forward `Upgrade`/`Connection` headers, otherwise the terminal and live logs silently stop updating.

### Updating

```bash
cd /opt/dockcg
git pull                              # if you cloned this repo
docker compose build && docker compose up -d
```

Your stacks and database live in mounted volumes, so a recreate keeps them.

### Backup and restore

Everything you need is two paths: `./data` (database + settings) and your stacks directory. Copy them while the container is stopped, or copy `data/dockcg.db` while it runs only if you accept a possible WAL race.

```bash
docker compose stop
tar czf dockcg-backup-$(date +%F).tar.gz data /opt/stacks
docker compose start
```

### Coming from Dockge

Dockcg reads the same database layout, so an existing Dockge installation can be moved over:

1. Stop the old container.
2. Move the data and rename the database:
   ```bash
   mv /opt/dockge/data /opt/dockcg/data
   mv /opt/dockcg/data/dockge.db /opt/dockcg/data/dockcg.db
   ```
3. Rename environment variables in your compose file: `DOCKGE_STACKS_DIR` → `DOCKCG_STACKS_DIR`.
4. Keep the stacks directory exactly where it was — the compose files and their paths are unchanged.
5. Start Dockcg and log in with your existing account. Registry credentials are **not** migrated (they were never stored by upstream); add them under `Settings → Registries`.

### Build from source

```bash
npm ci
npm run build:frontend                # writes frontend-dist/
docker build -f docker/Dockerfile --target release -t strange-dragon/dockcg:1 .
```

The `docker/Dockerfile` is self-contained: a `golang` stage compiles the healthcheck binary, a `node:22-bookworm-slim` stage installs `docker-ce-cli`, `docker-compose-plugin`, `dumb-init` and `tsx`, builds the frontend and drops privileges. No upstream base image is involved.

### Development

```bash
npm ci
npm run dev        # vite on :5000 + backend on :5001
npm run lint
npm run check-ts
```

`.github/workflows/ci.yml` runs the same steps plus a real end-to-end pass on an Ubuntu runner: it deploys a throwaway stack, starts the server, logs in over socket.io, exercises the resources API (51 assertions) and finally inspects the SQLite schema inside the built image.

---

## How it works

```
frontend (Vue 3 + Vite + TS)
      │  socket.io
backend (Node 22 + Express + socket.io)
      ├── redbean-node / SQLite  →  /app/data/dockcg.db
      ├── docker CLI (spawn, no shell) → images / volumes / networks / login
      └── agent sockets → other Docker hosts
```

The resources module deliberately shells out to the `docker` CLI instead of embedding a Docker SDK: the same code path then works for the local daemon and for every agent, and `docker login`/`pull` keep streaming through the existing terminal plumbing.

## Known limitations

- Containers cannot be created here — that is a design decision, not a missing feature.
- Registries store credentials in the container's `~/.docker/config.json`; mount `/root/.docker` or re-sync after a recreate.
- A volume migration copies bytes, it does not rewrite `compose.yaml` for you; the snippet on the page tells you what to paste.
- A network merge is additive (`docker network connect`). Making it permanent still requires the snippet plus `docker compose up -d`.
- Windows is not supported, and only English plus Simplified Chinese ship with the UI.

## FAQ

**Do I still need Portainer?** Only if you want to manage bare containers, `docker run` one-offs or Swarm. For compose stacks plus their resources, Dockcg covers it.

**Can I manage existing stacks?** Yes — move the compose file into the stacks directory (for example `/opt/stacks/my-app/compose.yaml`), stop the stack, then use *Scan stacks folder* in the profile menu.

**Will `docker prune` ever run without me asking?** No. Every removal is an explicit, itemised action.

**Why the name?** Upstream explains "Dockge" in its own README; this fork keeps the word and swaps the last letter for the author's initials. It is a fork, not a successor — please report core bugs upstream.

## Contributing

- Issues and feature requests: <https://github.com/strange-dragon/dockcg/issues>
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.
- Security reports: [SECURITY.md](./SECURITY.md).
- Translations: only `en` and `zh-CN` are wired up on purpose; see [frontend/src/lang/README.md](./frontend/src/lang/README.md).

## License

MIT, inherited from [louislam/dockge](https://github.com/louislam/dockge). The original copyright notice is kept in [LICENSE](./LICENSE).

---

<sub>中文版见 [README.zh-CN.md](./README.zh-CN.md)。</sub>

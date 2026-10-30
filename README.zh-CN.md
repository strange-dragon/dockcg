<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# Dockcg

一个以 compose 为中心的 Docker 堆栈管理器，fork 自 [Dockge](https://github.com/louislam/dockge)，并扩展出「Docker 资源」模块：在 compose 之外启动的容器、镜像、存储卷、网络和仓库凭据。

[![GitHub Repo stars](https://img.shields.io/github/stars/strange-dragon/dockcg?logo=github&style=flat)](https://github.com/strange-dragon/dockcg) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/strange-dragon/dockcg/master?logo=github)](https://github.com/strange-dragon/dockcg/commits/master/) [![License](https://img.shields.io/github/license/strange-dragon/dockcg)](./LICENSE)

![堆栈：左栏选堆栈，右侧编辑 compose.yaml](./docs/screenshots/stacks.png)

---

## Docker 资源

本 fork 新增，其余 compose 工作流保持不变：

- **容器** —— 只读清点；任意容器都能转成 **Compose 草稿**（镜像、环境变量、端口、挂载、重启策略、网络），原容器不停不删。
- **镜像** —— 使用中 / 未使用 / 悬空状态，使用该镜像的容器、同 ID 的全部标签、摘要、平台，带实时进度的预拉取，定向删除，清理前先预览。
- **存储卷** —— 挂载点、归属堆栈与服务、孤儿卷清理、按需算磁盘占用，以及**复制到新建空卷**（源卷始终保留）。
- **网络** —— 清点之外还有关联视图：把服务拖到网络上，自动改写它的 `compose.yaml`（先预览、带哈希校验）。合并网络走同一路径。未纳管容器给 `external: true` 片段。
- **仓库** —— Docker Hub / ghcr.io / Harbor 凭据，后台执行 `docker login`，口令加密落库。
- **概览** —— 一页看完四类资源的数量，并从同一处发起带预览的清理。

三条规则写在代码里，不只是写在文档里：**容器生命周期不出 compose**、**改动用 `compose.yaml` 承载而不是隐藏的 CLI 调用**、**清理逐项进行，绝不 `docker prune`**。

| 镜像 | 存储卷 |
|---|---|
| ![镜像详情](./docs/screenshots/images.png) | ![存储卷详情](./docs/screenshots/volumes.png) |

其余部分 —— 堆栈管理、编辑器、终端、agent 配置、扫描堆栈目录 —— 都是上游原有行为，见 [Dockge 的 README](https://github.com/louislam/dockge)。

---

## 🔧 安装

### 环境要求

- Docker 20+ 且带 `docker compose` 插件（或 Podman + `podman-docker`）
- Linux：Ubuntu、Debian/Raspbian Bullseye 及以上、CentOS、Fedora、Arch。不支持 Windows
- `amd64`、`arm64` 或 `armv7`

> 镜像**尚未发布**。仓库里的 `compose.yaml` 带 `build:` 段，首次启动会在本地构建。

### 快速开始

```bash
mkdir -p /opt/stacks /opt/dockcg
cd /opt/dockcg

curl https://raw.githubusercontent.com/strange-dragon/dockcg/master/compose.yaml --output compose.yaml
docker compose up -d --build
```

打开 <http://localhost:5001>，创建管理员账号。

### compose.yaml

```yaml
services:
  dockcg:
    image: strange-dragon/dockcg:1
    build:                      # 发布自己的镜像后可删除
      context: .
      dockerfile: docker/Dockerfile
      target: release
    restart: unless-stopped
    ports:
      - 5001:5001
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # 必需
      - ./data:/app/data                            # 数据库 + 设置
      # - /root/.docker/:/root/.docker              # 可选：保留仓库登录态
      - /opt/stacks:/opt/stacks                     # 两侧路径必须一致
    environment:
      - DOCKCG_STACKS_DIR=/opt/stacks
```

⚠️ 堆栈挂载两侧必须是同一个绝对路径（`/opt/stacks:/opt/stacks`），否则宿主机的 `docker compose` 看不到 Dockcg 写的文件。

### 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DOCKCG_STACKS_DIR` | `/opt/stacks` | 容器内堆栈目录。 |
| `DOCKCG_DATA_DIR` | `/app/data` | SQLite 数据库、设置、agent 列表。 |
| `DOCKCG_PORT` | `5001` | 容器内 HTTP 端口。 |
| `DOCKCG_HOSTNAME` | 自动 | 界面显示的主机名。 |
| `DOCKCG_SSL_KEY` / `DOCKCG_SSL_CERT` / `DOCKCG_SSL_KEY_PASSPHRASE` | — | 直接提供 HTTPS。 |
| `DOCKCG_ENABLE_CONSOLE` | `true` | `false` 隐藏全局终端。 |
| `DOCKCG_HIDE_LOG` | — | `1` 不打印日志前缀。 |
| `PUID` / `PGID` | `root` | 堆栈文件所有者（两个都要设）。 |
| `TZ` | 容器默认 | 日志时区，如 `Asia/Shanghai`。 |

反向代理（Caddy / nginx / Traefik，含 websocket）见 [docs/reverse-proxy.md](./docs/reverse-proxy.md)。

### 升级与备份

```bash
git pull && docker compose build && docker compose up -d    # 升级

docker compose stop                                         # 备份
tar czf dockcg-backup-$(date +%F).tar.gz data /opt/stacks
docker compose start
```

### 从 Dockge 迁移

```bash
mv /opt/dockge/data /opt/dockcg/data
mv /opt/dockcg/data/dockge.db /opt/dockcg/data/dockcg.db
```

然后把 compose 文件里的 `DOCKGE_STACKS_DIR` 改成 `DOCKCG_STACKS_DIR`，堆栈目录原地不动，用原账号登录即可。仓库凭据不会迁移，到 `设置 → 私有仓库` 重新添加。

### 从源码构建

```bash
npm ci && npm run build:frontend
docker build -f docker/Dockerfile --target release -t strange-dragon/dockcg:1 .
```

`docker/Dockerfile` 自包含：`golang` 阶段编译健康检查，`node:22-bookworm-slim` 阶段装 `docker-ce-cli`、`compose-plugin`、`dumb-init`、`tsx` 再构建前端。不从上游 Docker Hub 命名空间拉任何东西。

---

## 已知限制

- 这里不能创建、启动或停止容器 —— 这是设计本身。容器标签只生成草稿。
- 卷复制只写到**新建**卷，不改写 `compose.yaml`，目标卷已存在会拒绝。
- 网络变更只作用于归属受管理堆栈的容器，且不会替你部署。
- 清理不会删除仍在受管理 Compose 文件中声明的卷或网络。
- 界面只有英文与简体中文，默认英文。

## 署名

应用本体、UI、编辑器、终端和 agent 协议来自 MIT 协议下的 [louislam/dockge](https://github.com/louislam/dockge)。本项目只加了资源模块并做了重命名。核心功能的问题请反馈上游；资源模块的问题提[这里](https://github.com/strange-dragon/dockcg/issues)。

## 许可证

MIT，继承自 Dockge，原始版权声明保留在 [LICENSE](./LICENSE)。

---

<sub>English version: [README.md](./README.md).</sub>

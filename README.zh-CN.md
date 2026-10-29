<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# Dockcg

一个以 compose 为中心的自托管 Docker 堆栈管理器 —— **基于 [Dockge](https://github.com/louislam/dockge) 的二次开发（fork）**。保留上游的 compose 工作流，同时新增「系统资源」模块，用来管理堆栈自己管不到的那部分：镜像、存储卷、网络和私有仓库凭据。

[![GitHub Repo stars](https://img.shields.io/github/stars/strange-dragon/dockcg?logo=github&style=flat)](https://github.com/strange-dragon/dockcg) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/strange-dragon/dockcg/master?logo=github)](https://github.com/strange-dragon/dockcg/commits/master/) [![License](https://img.shields.io/github/license/strange-dragon/dockcg)](./LICENSE)

![堆栈：左栏选堆栈，右侧编辑 compose.yaml](./docs/screenshots/stacks.png)

---

## 这个 fork 是什么

Dockcg **不是**重写。它就是 Dockge，只是把职责范围往外扩了一圈：Dockge 管 `compose.yaml`，Dockcg 管 `compose.yaml` **以及这些文件依赖的 Docker 资源**。

上游的能力一个都没少 —— 堆栈列表、在线编辑器、网页终端、多主机 agent、`docker run` 转 compose。会用 Dockge 就会用 Dockcg，区别只是侧边栏多了四个标签。

| | Dockge（上游） | Dockcg（本项目） |
|---|---|---|
| 职责范围 | `compose.yaml` 生命周期 | `compose.yaml` **+ 镜像 / 存储卷 / 网络 / 私有仓库** |
| 导航 | 只有堆栈列表 | 左栏在 堆栈 / 镜像 / 存储卷 / 网络 之间切换，点行进入对应详情页 |
| 镜像 | 只能跟随堆栈拉取 | 清点列表，标注 使用中 / 未使用 / 悬空；带进度预拉取；定向删除；清理未使用与悬空镜像 |
| 存储卷 | 由 compose 隐式持有 | 挂载点、驱动、作用域、归属堆栈与服务、孤儿卷清理、**迁移到新卷** |
| 网络 | 未暴露 | bridge/overlay/host 清点、**拓扑图**、跨堆栈 `external: true` 片段生成、**合并到共享网络** |
| 私有仓库 | 未暴露 | Docker Hub / ghcr.io / Harbor 凭据，后台执行 `docker login`，口令加密落库 |
| 语言 | 30 多种 | 仅英文 + 简体中文（默认英文） |
| 品牌 | `DOCKGE_*` 环境变量、`dockge.db`、`louislam/dockge` 镜像 | `DOCKCG_*`、`dockcg.db`、`strange-dragon/dockcg`，不从上游 Docker Hub 命名空间拉任何东西 |
| 容器镜像 | 上游 base 镜像 + 健康检查镜像 | 单个自包含 `docker/Dockerfile`（多阶段，不依赖上游基础镜像） |

**该给的署名都给：** 应用本体、UI 语言、compose 编辑器、agent 协议和大部分后端都来自 MIT 协议下的 [louislam/dockge](https://github.com/louislam/dockge)。本项目只加了资源模块并做了重命名；核心功能的问题归上游，好点子也是上游的。

## 三条设计边界

整个资源模块都受这三条约束，而且约束写在代码里，不只是写在文档里。

1. **容器生命周期不出 compose。** 没有 `docker run` 表单，没有裸容器的启动/停止按钮，没有「新建容器」向导。容器的创建、更新、销毁永远由 `docker compose up -d` 完成。
2. **声明式优先。** 这里建的存储卷和网络，是为了让 `compose.yaml` 能用 `external: true` 接进去。UI 直接把片段给你，而不是把这件事藏起来。
3. **清理是定向的，绝不 `docker prune`。** 后端先算出候选清单，逐个删除，凡是被容器占用或属于某个 compose 项目的一律拒绝。

## 界面截图

| 镜像 | 存储卷 |
|---|---|
| ![镜像详情：使用它的容器、层、摘要、平台](./docs/screenshots/images.png) | ![存储卷详情：挂载点、归属堆栈、迁移](./docs/screenshots/volumes.png) |

| 网络 | 堆栈 |
|---|---|
| ![网络详情：拓扑图、已接入容器、合并与共享](./docs/screenshots/networks.png) | ![堆栈详情：容器、终端、compose.yaml](./docs/screenshots/stacks.png) |

## 功能

### Compose 管理（继承上游）

- 🧑‍💼 创建 / 编辑 / 启动 / 停止 / 重启 / 删除 `compose.yaml` 堆栈
- ⌨️ YAML 智能补全的在线编辑器
- 🦦 每个容器的网页终端，拉取与启动输出实时流式回传
- 🕷️ 多 agent —— 一个界面管理多台 Docker 主机
- 🏪 把 `docker run ...` 命令转成 `compose.yaml`
- 📙 文件即真相 —— compose 文件留在原地，随时可用原生 `docker compose` 操作
- 🚄 响应式 —— 进度和日志走 websocket，不轮询
- 🌐 英文与简体中文，默认英文（`设置 → 外观 → 语言`）

### 系统资源（本项目新增）

**镜像** —— 标签、大小、创建时间；依据 `com.docker.compose.project` 标签解析「使用中 / 未使用 / 悬空」；列出使用该镜像的容器、同一镜像 ID 的所有标签、摘要、平台、入口命令、暴露端口；带实时进度的预拉取；定向删除；清理未使用或悬空镜像。

**存储卷** —— 挂载点、驱动、作用域、标签、归属堆栈与服务、已挂载容器、自动生成的 `compose.yaml` 片段、孤儿卷清理，以及**迁移**：用一段临时的 `alpine:3` 容器把数据复制到新卷或已有卷，之后你把 `compose.yaml` 指向新卷即可。只要有容器还在挂载源卷，迁移会被拒绝执行。

**网络** —— 驱动、子网、作用域、internal 标记、已接入容器、**拓扑图**（宿主 → 网络 → 容器，当前网络高亮）、提供方与使用方的 `external: true` 片段、清理，以及**合并**：所选网络上的容器通过 `docker network connect` 额外加入目标网络，于是它们之间可以用容器名互访，而原网络保持不变。

**私有仓库**（`设置 → 私有仓库`）—— Docker Hub、ghcr.io 或私有 Harbor；`docker login` 在后台执行，口令用 AES-256-GCM 加密（密钥由服务端密钥派生），永不回传浏览器。凭据最终落在容器的 `~/.docker/config.json`，所以要么把该目录挂出来，要么在容器重建后再点一次「全部同步」。

---

## 🔧 安装

### 环境要求

- Docker 20+（需要 `docker compose` 插件）或 Podman
  - 用 Podman 还需 `podman-docker`（Debian/Ubuntu：`apt install podman-docker`）
- 能跑 Docker 的 Linux 主机：
  - ✅ Ubuntu、Debian（Bullseye 及以上）、Raspbian（Bullseye 及以上）、CentOS、Fedora、Arch Linux
  - ❌ Debian/Raspbian Buster 及更早，❌ Windows（暂不支持）
- 架构：`amd64`（x86_64）、`arm64`、`armv7`

> 镜像目前**尚未发布**。仓库里的 `compose.yaml` 带有 `build:` 段，首次启动会在本地构建。等你推了自己的镜像后，填好 `image:` 并删掉 `build:` 即可。

### 快速开始

默认值：堆栈目录 `/opt/stacks`，Web 端口 `5001`，数据目录 `./data`。

```bash
# 1. 建两个目录：一个放你的堆栈，一个放 Dockcg 自己
mkdir -p /opt/stacks /opt/dockcg
cd /opt/dockcg

# 2. 下载 compose 文件
curl https://raw.githubusercontent.com/strange-dragon/dockcg/master/compose.yaml --output compose.yaml

# 3. 构建并启动（首次会编译前端和健康检查）
docker compose up -d --build

# Docker Compose v1 或 Podman：
# docker-compose up -d --build
```

打开 <http://localhost:5001>，首次进入时创建管理员账号。

### compose 文件逐行说明

```yaml
services:
  dockcg:
    image: strange-dragon/dockcg:1
    build:                      # 等你发布自己的镜像后可删除
      context: .
      dockerfile: docker/Dockerfile
      target: release
    restart: unless-stopped
    ports:
      - 5001:5001               # 宿主机:容器
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # 必需：与 docker daemon 通信
      - ./data:/app/data                            # 数据库、设置、agent 配置
      # - /root/.docker/:/root/.docker              # 可选：容器重建后仍保留仓库登录态
      - /opt/stacks:/opt/stacks                     # 堆栈目录 —— 宿主机路径必须与容器内路径一致
    environment:
      - DOCKCG_STACKS_DIR=/opt/stacks
```

⚠️ **堆栈挂载两侧路径必须完全一致**（`/opt/stacks:/opt/stacks`）。写成 `/docker:/my-stacks` 这类不一致的形式，Dockcg 会把文件写到你的 `docker compose` 命令看不到的地方。两侧都必须是**绝对路径**。

### 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `DOCKCG_STACKS_DIR` | `/opt/stacks` | 容器内堆栈目录，宿主机需挂载同一路径。 |
| `DOCKCG_DATA_DIR` | `/app/data` | SQLite 数据库、设置、agent 列表。不挂载则容器重建后配置全丢。 |
| `DOCKCG_PORT` | `5001` | 容器内 HTTP 端口。要改宿主机端口请改 `ports:` 左边。 |
| `DOCKCG_HOSTNAME` | 自动 | 界面/健康检查里显示的主机名。通过域名访问时建议设置。 |
| `DOCKCG_SSL_KEY` / `DOCKCG_SSL_CERT` / `DOCKCG_SSL_KEY_PASSPHRASE` | — | 不用反向代理、直接由容器提供 HTTPS 时使用。 |
| `DOCKCG_ENABLE_CONSOLE` | `true` | 设为 `false` 可隐藏全局控制台/终端。 |
| `DOCKCG_HIDE_LOG` | — | `1` 表示日志不打印时间与级别前缀。 |
| `PUID` / `PGID` | `root` | 堆栈文件的所有者。**两个都设**才生效。 |
| `TZ` | 容器默认 | 日志时间戳时区，如 `Asia/Shanghai`。 |

### 放在反向代理后面

Caddy、nginx、Traefik 的配置（含 websocket 升级）见 [docs/reverse-proxy.md](./docs/reverse-proxy.md)。一句话版本：一定要转发 `Upgrade` / `Connection` 头，否则终端和实时日志会静默停止刷新。

### 升级

```bash
cd /opt/dockcg
git pull                              # 如果你是 clone 的仓库
docker compose build && docker compose up -d
```

堆栈与数据库都在挂载卷里，重建容器不会丢。

### 备份与恢复

需要备份的只有两个位置：`./data`（数据库 + 设置）和你的堆栈目录。停容器时复制最稳；运行中只复制 `data/dockcg.db` 有 WAL 竞态风险。

```bash
docker compose stop
tar czf dockcg-backup-$(date +%F).tar.gz data /opt/stacks
docker compose start
```

### 从 Dockge 迁移过来

Dockcg 沿用同一套数据库结构，老 Dockge 安装可以直接搬：

1. 停掉旧容器。
2. 迁移数据并改数据库文件名：
   ```bash
   mv /opt/dockge/data /opt/dockcg/data
   mv /opt/dockcg/data/dockge.db /opt/dockcg/data/dockcg.db
   ```
3. 改 compose 文件里的环境变量：`DOCKGE_STACKS_DIR` → `DOCKCG_STACKS_DIR`。
4. 堆栈目录保持原样不动 —— compose 文件和里面的路径都没变。
5. 启动 Dockcg，用原账号登录。私有仓库凭据**不会**迁移（上游本来就没存），到 `设置 → 私有仓库` 重新添加即可。

### 从源码构建

```bash
npm ci
npm run build:frontend                # 产物在 frontend-dist/
docker build -f docker/Dockerfile --target release -t strange-dragon/dockcg:1 .
```

`docker/Dockerfile` 是自包含的：`golang` 阶段编译健康检查二进制，`node:22-bookworm-slim` 阶段安装 `docker-ce-cli`、`docker-compose-plugin`、`dumb-init`、`tsx`，构建前端并降权运行。不涉及任何上游基础镜像。

### 本地开发

```bash
npm ci
npm run dev        # vite 在 :5000，后端在 :5001
npm run lint
npm run check-ts
```

`.github/workflows/ci.yml` 跑同样的步骤，另外在 Ubuntu runner 上做一次真实端到端验证：部署一个一次性堆栈、启动服务、用 socket.io 登录、跑资源相关的 51 条断言，最后进入构建好的镜像里检查 SQLite 表结构。

---

## 实现思路

```
frontend（Vue 3 + Vite + TS）
      │  socket.io
backend（Node 22 + Express + socket.io）
      ├── redbean-node / SQLite  →  /app/data/dockcg.db
      ├── docker CLI（spawn 直调，不过 shell）→ 镜像 / 卷 / 网络 / 登录
      └── agent socket → 其他 Docker 主机
```

资源模块刻意选择直接调 `docker` CLI 而不引入 Docker SDK：这样同一份代码对本地 daemon 和每个 agent 都成立，`docker login` 与 `pull` 也能复用已有的终端流式通道。

## 已知限制

- 这里不能创建容器 —— 这是设计取舍，不是没做完。
- 仓库凭据保存在容器的 `~/.docker/config.json`，重建后请挂载 `/root/.docker` 或点一次同步。
- 存储卷迁移只搬运数据，不会替你改写 `compose.yaml`；页面上的片段告诉你要粘什么。
- 网络合并是叠加式的（`docker network connect`）。要让它永久生效，仍需按片段修改并 `docker compose up -d`。
- 不支持 Windows；界面只提供英文与简体中文。

## 常见问题

**还需要 Portainer 吗？** 只有当你需要管理裸容器、临时 `docker run` 或 Swarm 时才需要。compose 堆栈及配套资源，Dockcg 已经够用。

**能接管已有的堆栈吗？** 能 —— 把 compose 文件放进堆栈目录（例如 `/opt/stacks/my-app/compose.yaml`），停掉原堆栈，然后在头像菜单里点「扫描堆栈目录」。

**会在我不知情的时候跑 `docker prune` 吗？** 不会。每次删除都是明确的、逐项确认的操作。

**为什么叫 Dockcg？** 名字来自上游 Dockge 的那套命名梗，本项目保留了词干、换了结尾字母。它是 fork，不是继任者 —— 核心功能的问题请反馈给上游。

## 参与贡献

- 问题与需求：<https://github.com/strange-dragon/dockcg/issues>
- 提 PR 前请先读 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- 安全问题：[SECURITY.md](./SECURITY.md)。
- 翻译：界面只接入了 `en` 与 `zh-CN`，细节见 [frontend/src/lang/README.md](./frontend/src/lang/README.md)。

## 许可证

MIT，继承自 [louislam/dockge](https://github.com/louislam/dockge)，原始版权声明保留在 [LICENSE](./LICENSE)。

---

<sub>English version: [README.md](./README.md).</sub>

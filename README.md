# Git 提交历史 · DeepSeek Harness 插件

> 兼容性：在 **DeepSeek Harness 0.2.2-rc.3（Windows 桌面版）** 上开发并验证；依赖其
> `connection.fetch` 与右侧边栏 tab 注册 API。更老的 DSH 版本可能不提供这些接口。

## 下载

- 最新安装包：[Releases](https://github.com/JiaLe1145/dsh-plugin-git-history/releases/latest)
- 开发/定制：`git clone https://github.com/JiaLe1145/dsh-plugin-git-history.git`，直接把仓库目录当作插件目录安装

欢迎提 Issue 与 PR：<https://github.com/JiaLe1145/dsh-plugin-git-history>

在 DeepSeek Harness 的**右侧边栏**里查看当前仓库的 Git 提交历史，按 IDE 的用法设计：

- 分支、`↑ 领先 / ↓ 落后`、未提交改动数量
- 提交泳道图（彩色节点 + 连线，不是字符画）
- 严格按日期倒序，带粘性日期分组
- refs 徽标（HEAD / 分支 / tag）、作者、相对时间
- 提交详情：完整信息、变更文件（+/- 行数）、**按文件分段、带行号、带颜色的 diff**
- 点「变更文件」里的条目会滚动到对应的 diff 段
- 键盘：`↑↓` 选择、`Enter` 打开、`Esc` 返回、`r` 刷新、`/` 搜索
- 搜索提交信息 / 作者 / 短哈希
- 一键复制完整哈希
- 支持合并提交（相对第一父提交展示 diff）
- 仓库路径在面板里选择，记住最近 5 个

## 安装

1. 解压本包，得到 `dsh-plugin-git-history/` 目录。
2. 打开 DeepSeek Harness → **设置 / 插件**（Plugins）→ **添加插件（Add plugin）** → 选择该目录（选择包含 `package.json` 的那一层）。
3. **完全退出并重启 DeepSeek Harness**（宿主插件需要重新加载）。
4. 刷新页面（`Ctrl+R`），打开右侧边栏，点 **+**，选择 **Git 提交历史**。
5. 首次打开会提示选择仓库：填仓库根目录的**绝对路径**（如 `C:/code/my-repo`），回车或点「应用」。

> 也可以在 `cordis.patch.yml` 里把 `repo` 写死，插件安装后位于 profile 的 `node_modules/dsh-plugin-git-history/`。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `repo` | `''` | 默认仓库绝对路径；留空则用 Host 工作目录，并提示在面板里选择 |
| `debug` | `false` | `true` 时把每次请求与 git 错误写入插件目录下的 `host-debug.log`（超过 512 KB 自动轮转） |

## 它执行什么

只读，不提交、不切分支、不 fetch、不执行 hooks：

| 用途 | 命令 |
|---|---|
| 校验仓库 | `git rev-parse --is-inside-work-tree` |
| 分支 / 领先落后 / 脏文件 | `git status --porcelain=v1 -b` |
| 提交列表 | `git log -n<N> --date=iso-strict --pretty=format:... --no-color` |
| 提交元信息 | `git show -s --date=iso-strict --pretty=format:... <hash>` |
| 合并提交的父提交 | `git rev-list --parents -n1 <hash>` |
| 变更文件统计 | `git show --numstat` 或 `git diff --numstat <first-parent> <hash>` |
| patch | `git show --patch` 或 `git diff --patch <first-parent> <hash>` |

环境固定 `GIT_PAGER=cat`、`GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`。

## 接口

宿主注册两条只读路由（挂在 Harness 的 `/api` 通道下，沿用 Harness 自身的会话鉴权）：

- `GET /api/git-history.log?limit=150&repo=<绝对路径>` → 分支、ahead/behind、脏文件数、提交列表
- `GET /api/git-history.commit?hash=<sha>&repo=<绝对路径>` → 提交元信息、文件统计、patch

## 限制

- 只读：不提供提交、切换分支、拉取等写操作。
- 一次最多 400 条提交（默认 150，可「加载更多」）。
- 单次 patch 超过约 240 KB 会截断；界面只给前 2000 行着色，其余提示行数。
- 文件列表最多展示 40 个，其余在下方 patch 中查看。
- 合并提交按「相对第一父提交」展示，与 GitHub 的合并提交视图一致。
- 仓库路径为绝对路径；选择记录保存在浏览器 localStorage，不跨设备同步。

## 开发

直接修改目录内文件即可：

- 改 `client.js` → 刷新页面生效（前端模块重新拉取）。
- 改 `index.js` → 需要重启 DeepSeek Harness（宿主模块有缓存）。

## License

MIT

# Git 提交历史面板

在 DeepSeek Harness 的**右侧边栏**增加一个 Git 面板，按 IDE 的提交历史视图展示：
分支与领先/落后、脏文件数、提交泳道图、提交列表、单个提交的变更文件与彩色 diff。

## 使用

1. 在会话里打开右侧边栏（右侧边栏的 **+** 按钮，或它默认的引导页）。
2. 选择 **Git 提交历史** 卡片，面板会以标签页形式打开。
3. 顶部显示仓库名、当前分支、`↑领先 / ↓落后`、脏文件数；点 **⌂** 选择仓库，**↻** 重新读取。
4. 点击任意提交查看详情：提交信息、作者/时间、变更文件（含增删行数）、按文件分段并带行号的彩色 patch。
5. 详情里按 **Esc** 或点左上角 **‹** 返回列表；列表支持搜索，键盘 `↑↓` 选择、`Enter` 打开、`r` 刷新、`/` 搜索。

## 配置

仓库路径有两种来源，优先级：面板里选择的路径 → 插件行 `config.repo` → Host 工作目录。

```yaml
- insert:
    - id: git-history
      name: 'dsh-plugin-git-history'
      config:
        repo: ''      # 可写死绝对路径，例如 'C:/code/my-repo'
        debug: false   # true 时把每次请求写入 host-debug.log
```

面板里选择的仓库保存在浏览器 `localStorage`（`dsh-plugin-git-history:repo`），最近 5 个记在
`dsh-plugin-git-history:recent`；不跨设备同步。修改 `config.repo` 后需要重新加载插件。

## 它执行什么

面板是只读的，只调用这些 git 子命令：

| 用途 | 命令 |
|---|---|
| 校验仓库 | `git rev-parse --is-inside-work-tree` |
| 分支/领先落后/脏文件 | `git status --porcelain=v1 -b` |
| 提交列表 | `git log -n<limit> --date=iso-strict --pretty=format:... --no-color` |
| 单个提交元信息 | `git show -s --date=iso-strict --pretty=format:... <hash>` |
| 父提交（合并提交） | `git rev-list --parents -n1 <hash>` |
| 变更文件统计 | `git show --numstat` / `git diff --numstat <first-parent> <hash>` |
| patch | `git show --patch` / `git diff --patch <first-parent> <hash>` |

环境上固定 `GIT_PAGER=cat`、`GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`：
不写索引、不弹凭据、不执行分页。

## 限制

- **只读**：不提交、不切换分支、不拉取；工作区有未提交改动时只显示脏文件数量。
- **不联网**：不执行 `fetch`，ahead/behind 基于本地已知的远端引用。
- **合并提交**：`git show` 对 merge 默认不输出 diff，面板改为「相对第一父提交」展示，与 GitHub 合并提交视图一致。
- **patch 上限**：单次 patch 超过约 240 KB 截断；界面只给前 2000 行着色，其余显示行数。
- **文件列表**：最多展示 40 个文件，其余在下方 patch 中查看。
- **提交上限**：一次最多 400 条（默认 150，可「加载更多」）。
- **路径必须绝对**：相对路径会被宿主拒绝；选择记录只存在浏览器本地。
- **鉴权**：接口挂在 `/api` 前缀下，沿用 Harness 自己的会话 cookie 校验，不额外暴露路由。

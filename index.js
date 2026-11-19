// dsh-plugin-git-history —— Host 半身
//
// 在右侧边栏提供"Git 提交历史"面板所需的两条只读接口：
//   GET /api/git-history.log      → 当前分支、ahead/behind、脏文件数、提交列表（含 git --graph 前缀）
//   GET /api/git-history.commit   → 单个提交的元信息、文件统计与 patch
//
// 数据全部来自本机 git 命令，仓库路径由插件行的 config.repo 指定；
// 不写仓库、不 fetch、不执行 hooks（GIT_OPTIONAL_LOCKS=0 / GIT_TERMINAL_PROMPT=0）。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const MAX_PATCH_CHARS = 240_000
const MAX_BUFFER = 32 * 1024 * 1024
const MAX_DEBUG_BYTES = 512 * 1024

// DSH 的工作区清单：用它把「当前会话」映射到仓库目录，面板打开时就能自动选中。
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json')

// 诊断日志：宿主代码改动需要重启 DSH 才生效，出问题时看这个文件能少一轮猜测。
const DEBUG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host-debug.log')
function debug(line) {
  try {
    let size = 0
    try {
      size = statSync(DEBUG_FILE).size
    } catch {
      size = 0
    }
    if (size > MAX_DEBUG_BYTES) {
      writeFileSync(DEBUG_FILE, `${new Date().toISOString()} log rotated\n`)
    }
    appendFileSync(DEBUG_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // 诊断失败绝不影响请求
  }
}

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function git(repo, args, timeout = 8000) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repo,
    timeout,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
    },
  })
  return stdout
}

function parseShortStat(text) {
  // git show --numstat --format= 的每一行：<adds>\t<dels>\t<path>，二进制为 -	-
  const files = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const [a, d, ...rest] = line.split('\t')
    const file = rest.join('\t')
    if (!file) continue
    files.push({
      path: file,
      additions: a === '-' ? null : Number(a),
      deletions: d === '-' ? null : Number(d),
      binary: a === '-',
    })
  }
  return files
}

function parseStatus(text) {
  const lines = text.split('\n').filter(Boolean)
  const header = lines.shift() || ''
  let ahead = 0
  let behind = 0
  const bracket = /\[([^\]]+)\]/.exec(header)
  if (bracket) {
    const a = /ahead (\d+)/.exec(bracket[1])
    const b = /behind (\d+)/.exec(bracket[1])
    if (a) ahead = Number(a[1])
    if (b) behind = Number(b[1])
  }
  let branch = ''
  let detached = false
  const m = /^## ([^.\s]+)/.exec(header)
  if (m) branch = m[1]
  if (header.includes('no branch') || header.startsWith('## HEAD')) detached = true
  return { branch, detached, ahead, behind, dirty: lines.length }
}

function parseLog(text) {
  const commits = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const sep = line.indexOf('\x1e')
    if (sep < 0) continue
    const fields = line.slice(sep + 1).split('\x1f')
    commits.push({
      hash: fields[0] || '',
      short: fields[1] || '',
      author: fields[2] || '',
      authorDate: fields[3] || '',
      refs: fields[4] || '',
      subject: fields[5] || '',
      parents: fields[6] ? fields[6].split(' ').filter(Boolean) : [],
    })
  }
  return commits
}

export const inject = ['connection']

/** 解析请求里的 repo 参数；做常见输入容错后再要求绝对路径。 */
function requestRepo(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback
  let value = String(raw).trim()
  // 去掉复制路径时带上的引号/反引号
  value = value.replace(/^["'`]+|["'`]+$/g, '').trim()
  // 接受 file:///C:/... 形式
  if (/^file:\/\//i.test(value)) {
    try {
      value = fileURLToPath(value)
    } catch {
      // 保持原值，交给下面的绝对路径判断报错
    }
  }
  // 展开 ~
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1))
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`The repository path must be absolute (received: ${String(raw).slice(0, 200)})`)
  }
  return path.resolve(value)
}

/** 读取 DSH 的工作区清单（失败时返回空数组，不影响插件）。 */
function readWorkspaces() {
  try {
    const data = JSON.parse(readFileSync(WORKSPACE_STORE, 'utf8'))
    const table = data && data.tables && data.tables.workspaces
    if (!table) return []
    return Object.entries(table).map(([id, workspace]) => ({
      id,
      path: workspace.path || '',
      title: workspace.title || workspace.path || '',
      sessionIds: Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [],
      updatedAt: workspace.updatedAt || '',
    }))
  } catch {
    return []
  }
}

async function isGitRepo(dir) {
  if (!dir) return false
  try {
    const out = await git(dir, ['rev-parse', '--is-inside-work-tree'], 3000)
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/** 校验目录确实在某个 git 工作树内，并给出可读的错误。 */
async function assertRepo(repo) {
  try {
    const out = await git(repo, ['rev-parse', '--is-inside-work-tree'], 5000)
    if (out.trim() !== 'true') throw new Error('not a work tree')
  } catch {
    throw new Error(`Not a git repository: ${repo}`)
  }
}

/** 读取某个提交的父提交列表（用于合并提交按"相对第一父提交"展示 diff）。 */
async function resolveParents(repo, hash) {
  const out = await git(repo, ['rev-list', '--parents', '-n1', hash], 5000)
  const parts = out.trim().split(/\s+/)
  return parts.slice(1)
}

export function apply(ctx, config) {
  const configuredRepo =
    config && typeof config.repo === 'string' && config.repo.trim() ? config.repo.trim() : ''
  const defaultRepo = path.resolve(configuredRepo || process.cwd())
  const debugEnabled = Boolean(config && config.debug)
  const trace = (line) => {
    if (debugEnabled) debug(line)
  }
  trace(`apply repo=${defaultRepo}`)

  const LOG_FORMAT = '%x1e%H%x1f%h%x1f%an%x1f%ad%x1f%D%x1f%s%x1f%P'
  const SHOW_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%cd%x1f%D%x1f%s%x1f%b'

  // 面板打开时先问这里：按会话找到所属工作区仓库，并列出可选工作区。
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/git-history.defaults',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        trace(`defaults request ${request.url}`)
        const url = new URL(request.url)
        const session = String(url.searchParams.get('session') || '')
        const workspaces = readWorkspaces()
        const match = session ? workspaces.find((item) => item.sessionIds.includes(session)) : null
        const checks = await Promise.all(
          workspaces.map(async (item) => ({ ...item, isGit: await isGitRepo(item.path) }))
        )
        const suggestions = checks
          .filter((item) => item.isGit)
          .map((item) => ({ path: item.path, title: item.title }))
        const detected = match && (await isGitRepo(match.path)) ? match.path : ''
        return json({ ok: true, detected, suggestions })
      } catch (error) {
        debug(`defaults error ${error && error.message ? error.message : error}`)
        return json({ ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'git-history: defaults route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/git-history.log',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        trace(`log request ${request.url}`)
        const url = new URL(request.url)
        const repo = requestRepo(url.searchParams.get('repo'), defaultRepo)
        const requested = Number(url.searchParams.get('limit') || 150)
        const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 400) : 150
        await assertRepo(repo)
        const [statusOut, logOut] = await Promise.all([
          git(repo, ['status', '--porcelain=v1', '-b']),
          git(repo, ['log', `-n${limit}`, '--date=iso-strict', `--pretty=format:${LOG_FORMAT}`, '--no-color']),
        ])
        const status = parseStatus(statusOut)
        return json({
          ok: true,
          repo,
          name: path.basename(repo),
          branch: status.branch,
          detached: status.detached,
          ahead: status.ahead,
          behind: status.behind,
          dirty: status.dirty,
          commits: parseLog(logOut),
        })
      } catch (error) {
        debug(`log error ${error && error.message ? error.message : error}`)
        return json({ ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'git-history: log route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/git-history.commit',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        trace(`commit request ${request.url}`)
        const url = new URL(request.url)
        const repo = requestRepo(url.searchParams.get('repo'), defaultRepo)
        const hash = String(url.searchParams.get('hash') || '')
        if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) {
          return json({ ok: false, error: 'invalid hash' })
        }
        await assertRepo(repo)
        // 合并提交：git show 默认不输出 diff，改为相对第一父提交比较，否则面板里是空的。
        const parents = await resolveParents(repo, hash)
        const mergeBase = parents.length > 1 ? parents[0] : null
        const [metaOut, numstatOut, patchOut] = await Promise.all([
          git(repo, ['show', '-s', '--date=iso-strict', `--pretty=format:${SHOW_FORMAT}`, hash]),
          mergeBase
            ? git(repo, ['diff', '--numstat', '--no-color', mergeBase, hash])
            : git(repo, ['show', '--numstat', '--format=', hash]),
          mergeBase
            ? git(repo, ['diff', '--patch', '--no-color', '--no-ext-diff', mergeBase, hash])
            : git(repo, ['show', '--format=', '--patch', '--no-color', '--no-ext-diff', hash]),
        ])
        const f = metaOut.split('\x1f')
        const patch = patchOut.length > MAX_PATCH_CHARS ? patchOut.slice(0, MAX_PATCH_CHARS) : patchOut
        return json({
          ok: true,
          commit: {
            hash: f[0] || hash,
            short: f[1] || hash,
            author: f[2] || '',
            authorEmail: f[3] || '',
            authorDate: f[4] || '',
            committer: f[5] || '',
            commitDate: f[6] || '',
            refs: f[7] || '',
            subject: f[8] || '',
            body: (f[9] || '').trim(),
            parents,
            files: parseShortStat(numstatOut),
            patch,
            patchTruncated: patchOut.length > MAX_PATCH_CHARS,
          },
        })
      } catch (error) {
        debug(`commit error ${error && error.message ? error.message : error}`)
        return json({ ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'git-history: commit route')
}

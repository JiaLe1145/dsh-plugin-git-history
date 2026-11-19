// dsh-plugin-git-history —— 浏览器半身（classic script，由 __ModuleLoader__ 装载）
// id 必须与 package.json 的 name 完全一致。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-git-history',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'dsh-plugin-git-history'
    const TAB_ID = 'dsh-plugin-git-history'
    const TAB_KIND = 'git-history'
    const PAGE = 150
    const MAX_PAGE = 400
    const RENDER_LINE_CAP = 2000
    const DETAIL_TIMEOUT_MS = 15000

    const zh = {
      'tab.title': 'Git 提交历史',
      'guide.title': 'Git 提交历史',
      'guide.description': '分支、领先/落后、提交图与每个提交的变更',
      refresh: '刷新',
      search: '搜索提交信息 / 作者 / 短哈希',
      loading: '读取中…',
      error: '读取失败',
      retry: '重试',
      back: '返回列表',
      files: '变更文件',
      moreFiles: '还有 %n 个文件（见下方 patch）',
      noPatch: '（没有可显示的 patch）',
      truncated: 'patch 过长，已截断显示',
      truncatedLines: 'patch 过大，剩余 %n 行未着色显示',
      empty: '这个仓库还没有提交',
      dirty: '个未提交改动',
      ahead: '领先',
      behind: '落后',
      loadMore: '加载更多提交',
      copyHash: '复制完整哈希',
      copied: '已复制',
      detached: '游离 HEAD',
      keyboard: '↑↓ 选择 · Enter 打开 · r 刷新 · / 搜索',
      chooseRepo: '选择仓库',
      repoPlaceholder: '仓库绝对路径，例如 C:/code/my-repo',
      applyRepo: '应用',
      clearRepo: '清除',
      repoMustBeAbsolute: '请填写绝对路径，例如 C:/code/my-repo',
      detectedRepo: '当前会话工作区',
      workspaceList: '工作区',
      needRepo: '先在 ⌂ 里选择一个仓库目录',
      mergeCommit: '合并提交 · 相对第一父提交的改动',
    }
    const en = {
      'tab.title': 'Git commit history',
      'guide.title': 'Git commit history',
      'guide.description': 'Branch, ahead/behind, commit graph and per-commit changes',
      refresh: 'Refresh',
      search: 'Search subject, author or short hash',
      loading: 'Loading…',
      error: 'Failed to load',
      retry: 'Retry',
      back: 'Back to list',
      files: 'Changed files',
      moreFiles: '%n more files (see the patch below)',
      noPatch: '(no patch to show)',
      truncated: 'Patch truncated',
      truncatedLines: '%n more patch lines not colored',
      empty: 'This repository has no commits yet',
      dirty: 'uncommitted changes',
      ahead: 'ahead',
      behind: 'behind',
      loadMore: 'Load more commits',
      copyHash: 'Copy full hash',
      copied: 'Copied',
      detached: 'detached HEAD',
      keyboard: '↑↓ select · Enter open · r refresh · / search',
      chooseRepo: 'Choose repository',
      repoPlaceholder: 'Absolute repository path, e.g. C:/code/my-repo',
      applyRepo: 'Apply',
      clearRepo: 'Clear',
      repoMustBeAbsolute: 'An absolute path is required, e.g. C:/code/my-repo',
      detectedRepo: 'Session workspace',
      workspaceList: 'Workspaces',
      needRepo: 'Choose a repository folder via ⌂ first',
      mergeCommit: 'Merge commit · changes against the first parent',
    }

    const C = {
      text: 'var(--dsw-alias-label-primary, inherit)',
      muted: 'var(--dsw-alias-label-secondary, #8b8b8b)',
      border: 'var(--dsw-alias-border-l1, rgba(127,127,127,.25))',
      hover: 'var(--dsw-alias-bg-l2, rgba(127,127,127,.10))',
      accent: 'var(--dsw-alias-brand-primary, #4c9aff)',
      code: 'var(--dsw-alias-bg-l1, rgba(127,127,127,.08))',
      base: 'var(--dsw-alias-bg-base, #141414)',
      add: 'var(--dsw-alias-success, #3fb950)',
      del: 'var(--dsw-alias-danger, #f85149)',
    }

    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
    const LANE_W = 14
    const ROW_H = 44
    const GRAPH_COLORS = ['#4c9aff', '#e8b84b', '#3fb950', '#f85149', '#b57bff', '#39c5cf', '#ff8c42', '#7d8590']

    const DETAIL_CACHE = new Map()
    const RTF =
      typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
        ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
        : null

    const REPO_KEY = 'dsh-plugin-git-history:repo'
    const RECENT_KEY = 'dsh-plugin-git-history:recent'
    const RECENT_MAX = 5

    function readStored(key) {
      try {
        return window.localStorage.getItem(key) || ''
      } catch {
        return ''
      }
    }

    function writeStored(key, value) {
      try {
        if (value) window.localStorage.setItem(key, value)
        else window.localStorage.removeItem(key)
      } catch {
        // 隐私模式/禁用存储时静默降级为仅本次会话有效
      }
    }

    function readRecent() {
      try {
        const parsed = JSON.parse(readStored(RECENT_KEY) || '[]')
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item) => typeof item === 'string' && item).slice(0, RECENT_MAX)
      } catch {
        return []
      }
    }

    function rememberRepo(repo) {
      if (!repo) return readRecent()
      const list = [repo, ...readRecent().filter((item) => item !== repo)].slice(0, RECENT_MAX)
      writeStored(RECENT_KEY, JSON.stringify(list))
      return list
    }

    function withRepo(url, repo) {
      if (!repo) return url
      return url + (url.includes('?') ? '&' : '?') + 'repo=' + encodeURIComponent(repo)
    }

    /** 客户端先挡一次非绝对路径，避免每次都打到宿主再返回错误。 */
    function absolutePath(value) {
      const trimmed = String(value || '')
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
      if (!trimmed) return ''
      if (
        /^[a-zA-Z]:[\\/]/.test(trimmed) ||
        trimmed.startsWith('\\\\') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('~/') ||
        trimmed.startsWith('~\\')
      ) {
        return trimmed
      }
      return ''
    }

    function laneColor(lane) {
      return GRAPH_COLORS[Math.abs(lane) % GRAPH_COLORS.length]
    }

    function fill(template, value) {
      return template.replace('%n', String(value))
    }

    /**
     * 用父提交关系算出每条提交所在泳道，替代 git 的 ASCII 图。
     * 提交顺序由调用方决定（这里按日期倒序），所以连线可能交叉，但节点/泳道是稳定的。
     */
    function buildGraph(commits) {
      const lanes = []
      const rows = []
      let laneCount = 1
      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i]
        const before = lanes.slice()
        let lane = lanes.indexOf(commit.hash)
        if (lane < 0) {
          lane = lanes.indexOf(null)
          if (lane < 0) {
            lane = lanes.length
            lanes.push(null)
          }
          lanes[lane] = commit.hash
        }
        const converging = []
        for (let k = 0; k < lanes.length; k++) {
          if (k !== lane && lanes[k] === commit.hash) {
            converging.push(k)
            lanes[k] = null
          }
        }
        const parents = Array.isArray(commit.parents) ? commit.parents : []
        const [firstParent, ...otherParents] = parents
        lanes[lane] = firstParent || null
        const mergeLanes = []
        for (const parent of otherParents) {
          let k = lanes.indexOf(parent)
          if (k < 0) {
            k = lanes.indexOf(null)
            if (k < 0) {
              k = lanes.length
              lanes.push(null)
            }
            lanes[k] = parent
          }
          mergeLanes.push(k)
        }
        rows.push({
          lane,
          converging,
          mergeLanes,
          nodeHash: commit.hash,
          before,
          after: lanes.slice(),
        })
        laneCount = Math.max(laneCount, lanes.length, before.length)
      }
      return { rows, laneCount }
    }

    function GraphCell({ row, laneCount }) {
      const width = laneCount * LANE_W
      const cx = (lane) => lane * LANE_W + LANE_W / 2
      const parts = []
      const push = (key, node) => parts.push(React.cloneElement(node, { key }))

      for (let k = 0; k < laneCount; k++) {
        const before = row.before[k]
        const after = row.after[k]
        const color = laneColor(k)
        if (k === row.lane) {
          if (before != null) {
            push('up' + k, h('line', { x1: cx(k), y1: 0, x2: cx(k), y2: ROW_H / 2, stroke: color, strokeWidth: 1.5, opacity: 0.9 }))
          }
          if (after != null) {
            push('down' + k, h('line', { x1: cx(k), y1: ROW_H / 2, x2: cx(k), y2: ROW_H, stroke: color, strokeWidth: 1.5, opacity: 0.9 }))
          }
        } else if (before === row.nodeHash) {
          push('conv' + k, h('path', {
            d: `M ${cx(k)} 0 C ${cx(k)} ${ROW_H * 0.35}, ${cx(row.lane)} ${ROW_H * 0.15}, ${cx(row.lane)} ${ROW_H / 2}`,
            fill: 'none',
            stroke: color,
            strokeWidth: 1.5,
            opacity: 0.9,
          }))
        } else if (row.mergeLanes.includes(k)) {
          push('merge' + k, h('path', {
            d: `M ${cx(row.lane)} ${ROW_H / 2} C ${cx(row.lane)} ${ROW_H * 0.8}, ${cx(k)} ${ROW_H * 0.7}, ${cx(k)} ${ROW_H}`,
            fill: 'none',
            stroke: color,
            strokeWidth: 1.5,
            opacity: 0.9,
          }))
        } else if (before != null) {
          push('pass' + k, h('line', { x1: cx(k), y1: 0, x2: cx(k), y2: ROW_H, stroke: color, strokeWidth: 1.5, opacity: 0.65 }))
        } else if (after != null) {
          push('new' + k, h('path', {
            d: `M ${cx(row.lane)} ${ROW_H / 2} C ${cx(row.lane)} ${ROW_H * 0.8}, ${cx(k)} ${ROW_H * 0.7}, ${cx(k)} ${ROW_H}`,
            fill: 'none',
            stroke: color,
            strokeWidth: 1.5,
            opacity: 0.9,
          }))
        }
      }

      push('node', h('circle', {
        cx: cx(row.lane),
        cy: ROW_H / 2,
        r: 4,
        fill: laneColor(row.lane),
        stroke: C.base,
        strokeWidth: 1.5,
      }))

      return h('svg', {
        width,
        height: ROW_H,
        viewBox: `0 0 ${width} ${ROW_H}`,
        style: { flex: '0 0 auto', overflow: 'visible', display: 'block' },
        'aria-hidden': true,
      }, parts)
    }

    function fmtDate(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function dayKey(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }

    /** 7 天以内显示"3 小时前"这类相对时间，更久显示绝对时间。 */
    function whenLabel(iso) {
      const d = new Date(iso)
      if (!iso || Number.isNaN(d.getTime())) return ''
      const diff = Date.now() - d.getTime()
      if (!RTF || diff < 0 || diff > 7 * 86400000) return fmtDate(iso)
      const minutes = Math.round(diff / 60000)
      if (minutes < 1) return RTF.format(0, 'second')
      if (minutes < 60) return RTF.format(-minutes, 'minute')
      const hours = Math.round(minutes / 60)
      if (hours < 24) return RTF.format(-hours, 'hour')
      return RTF.format(-Math.round(hours / 24), 'day')
    }

    /**
     * 把 unified diff 拆成「文件 → hunk → 行」，并给每行算出旧/新行号。
     * 只做展示用的轻量解析，不做重命名/二进制语义处理。
     */
    function parsePatch(patch) {
      const files = []
      if (!patch) return files
      let file = null
      let hunk = null
      let oldNo = 0
      let newNo = 0
      const lines = patch.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        if (raw.startsWith('diff --git ')) {
          const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw)
          file = { path: m ? m[2] || m[1] : raw.slice(11), header: [], hunks: [] }
          files.push(file)
          hunk = null
          continue
        }
        if (!file) continue
        if (raw.startsWith('@@')) {
          const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
          oldNo = m ? Number(m[1]) : 0
          newNo = m ? Number(m[2]) : 0
          hunk = { header: raw, lines: [] }
          file.hunks.push(hunk)
          continue
        }
        if (!hunk) {
          if (raw !== '') file.header.push(raw)
          continue
        }
        let type = 'ctx'
        if (raw.startsWith('+')) type = 'add'
        else if (raw.startsWith('-')) type = 'del'
        else if (raw.startsWith('\\')) type = 'meta'
        const oldNumber = type === 'add' || type === 'meta' ? null : oldNo
        const newNumber = type === 'del' || type === 'meta' ? null : newNo
        if (type !== 'add' && type !== 'meta') oldNo++
        if (type !== 'del' && type !== 'meta') newNo++
        hunk.lines.push({ type, text: raw, oldNumber, newNumber })
      }
      return files
    }

    function refList(refs) {
      if (!refs) return []
      return refs.split(', ').filter(Boolean).map((raw) => {
        let label = raw
        let kind = 'ref'
        if (raw.startsWith('HEAD -> ')) {
          label = raw.slice(8)
          kind = 'head'
        } else if (raw === 'HEAD') {
          kind = 'head'
        } else if (raw.startsWith('tag: ')) {
          label = raw.slice(5)
          kind = 'tag'
        } else if (raw.includes('HEAD')) {
          kind = 'head'
        }
        return { label, kind }
      })
    }

    function RefChips({ refs }) {
      const items = refList(refs)
      if (items.length === 0) return null
      return h(
        'span',
        { style: { display: 'inline-flex', gap: 4, flexWrap: 'nowrap', flexShrink: 0 } },
        items.map((item, i) =>
          h(
            'span',
            {
              key: item.label + i,
              style: {
                fontSize: 10,
                lineHeight: '15px',
                padding: '0 5px',
                borderRadius: 4,
                border: '1px solid ' + (item.kind === 'head' ? C.accent : C.border),
                color: item.kind === 'head' ? C.accent : item.kind === 'tag' ? C.muted : C.muted,
                background:
                  item.kind === 'tag' ? 'var(--dsw-alias-bg-l2, rgba(127,127,127,.10))' : 'transparent',
                whiteSpace: 'nowrap',
              },
            },
            item.label
          )
        )
      )
    }

    function Chip({ children, title, accent }) {
      return h(
        'span',
        {
          title,
          style: {
            fontSize: 10,
            lineHeight: '16px',
            padding: '0 5px',
            borderRadius: 4,
            border: '1px solid ' + (accent ? C.accent : C.border),
            color: accent ? C.accent : C.muted,
            whiteSpace: 'nowrap',
          },
        },
        children
      )
    }

    function Button({ onClick, title, children }) {
      const [over, setOver] = useState(false)
      return h(
        'button',
        {
          type: 'button',
          onClick,
          title,
          onMouseEnter: () => setOver(true),
          onMouseLeave: () => setOver(false),
          style: {
            appearance: 'none',
            border: '1px solid ' + C.border,
            background: over ? C.hover : 'transparent',
            color: C.text,
            borderRadius: 5,
            fontSize: 12,
            lineHeight: '18px',
            padding: '1px 7px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          },
        },
        children
      )
    }

    /** 带超时的 JSON 请求：超时或外部 signal 取消都会中止。 */
    async function fetchJson(url, signal, timeoutMs = DETAIL_TIMEOUT_MS) {
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })
        const text = await res.text()
        if (controller.signal.aborted) throw new Error('请求超时')
        if (!text) throw new Error(`HTTP ${res.status}（响应为空）`)
        let data
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error(`HTTP ${res.status}（非 JSON）：${text.slice(0, 160)}`)
        }
        if (!data || data.ok !== true) throw new Error((data && data.error) || `HTTP ${res.status}`)
        return data
      } finally {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
      }
    }

    function CommitRow({ commit, row, laneCount, active, showGraph, onOpen, registerRef, tr }) {
      const [over, setOver] = useState(false)
      const open = () => onOpen(commit.hash)
      return h(
        'div',
        {
          ref: registerRef,
          role: 'button',
          tabIndex: 0,
          onClick: open,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open()
            }
          },
          onMouseEnter: () => setOver(true),
          onMouseLeave: () => setOver(false),
          style: {
            display: 'flex',
            gap: 8,
            alignItems: 'stretch',
            padding: '0 8px',
            minHeight: ROW_H,
            borderBottom: '1px solid ' + C.border,
            background: active ? 'var(--dsw-alias-bg-l2, rgba(127,127,127,.16))' : over ? C.hover : 'transparent',
            outline: active ? '1px solid ' + C.border : 'none',
            cursor: 'pointer',
          },
        },
        showGraph && row ? h(GraphCell, { row, laneCount }) : null,
        h(
          'div',
          {
            style: {
              minWidth: 0,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '6px 0',
            },
          },
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 } },
            h(RefChips, { refs: commit.refs }),
            h(
              'span',
              {
                style: {
                  fontWeight: 600,
                  color: C.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              commit.subject
            )
          ),
          h(
            'div',
            {
              style: {
                fontSize: 11,
                color: C.muted,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            `${commit.short} · ${commit.author} · ${whenLabel(commit.authorDate)}`
          )
        )
      )
    }

    function PatchView({ sections, sectionRefs, tr }) {
      const rows = []
      let rendered = 0
      let omitted = 0

      const numberStyle = {
        width: 30,
        minWidth: 30,
        textAlign: 'right',
        paddingRight: 6,
        color: C.muted,
        opacity: 0.7,
        userSelect: 'none',
        fontSize: 10,
        lineHeight: '16px',
      }

      for (const file of sections) {
        rows.push(
          h(
            'div',
            {
              key: 'file-' + file.path,
              ref: (el) => {
                if (el) sectionRefs.current[file.path] = el
              },
              style: {
                padding: '4px 8px',
                fontFamily: MONO,
                fontSize: 11,
                color: C.text,
                background: 'var(--dsw-alias-bg-l2, rgba(127,127,127,.12))',
                borderTop: '1px solid ' + C.border,
                fontWeight: 600,
              },
            },
            file.path
          )
        )
        for (const meta of file.header) {
          rows.push(
            h(
              'div',
              {
                key: 'meta-' + file.path + '-' + rows.length,
                style: { padding: '0 8px', fontFamily: MONO, fontSize: 10, color: C.muted, lineHeight: '15px' },
              },
              meta
            )
          )
        }
        for (const hunk of file.hunks) {
          if (rendered >= RENDER_LINE_CAP) {
            omitted += hunk.lines.length
            continue
          }
          rows.push(
            h(
              'div',
              {
                key: 'hunk-' + file.path + '-' + rows.length,
                style: {
                  padding: '2px 8px',
                  fontFamily: MONO,
                  fontSize: 11,
                  color: C.accent,
                  background: 'rgba(76,154,255,.08)',
                  lineHeight: '16px',
                },
              },
              hunk.header
            )
          )
          for (const line of hunk.lines) {
            if (rendered >= RENDER_LINE_CAP) {
              omitted++
              continue
            }
            rendered++
            const color =
              line.type === 'add' ? C.add : line.type === 'del' ? C.del : line.type === 'meta' ? C.muted : C.text
            const bg =
              line.type === 'add' ? 'rgba(63,185,80,.12)' : line.type === 'del' ? 'rgba(248,81,73,.12)' : 'transparent'
            rows.push(
              h(
                'div',
                {
                  key: 'line-' + file.path + '-' + rendered,
                  style: { display: 'flex', background: bg, lineHeight: '16px' },
                },
                h('span', { style: numberStyle }, line.oldNumber == null ? '' : line.oldNumber),
                h('span', { style: numberStyle }, line.newNumber == null ? '' : line.newNumber),
                h(
                  'span',
                  {
                    style: {
                      flex: 1,
                      whiteSpace: 'pre',
                      fontFamily: MONO,
                      fontSize: 11,
                      color,
                      paddingRight: 8,
                    },
                  },
                  line.text || ' '
                )
              )
            )
          }
        }
      }

      if (omitted > 0) {
        rows.push(
          h(
            'div',
            { key: 'omitted', style: { padding: '4px 8px', fontSize: 11, color: C.muted } },
            fill(tr('truncatedLines'), omitted)
          )
        )
      }

      return h(
        'div',
        {
          style: {
            marginTop: 10,
            border: '1px solid ' + C.border,
            borderRadius: 6,
            overflow: 'auto',
            background: C.code,
          },
        },
        rows
      )
    }

    function DetailView({ tr, hash, repo, onBack, onRefresh }) {
      const [state, setState] = useState({ loading: true, error: '', commit: null })
      const [copied, setCopied] = useState(false)
      const alive = useRef(true)
      const sectionRefs = useRef({})

      const load = useCallback(
        async (force) => {
          const cacheKey = repo + '\u0000' + hash
          if (!force && DETAIL_CACHE.has(cacheKey)) {
            setState({ loading: false, error: '', commit: DETAIL_CACHE.get(cacheKey) })
            return
          }
          setState({ loading: true, error: '', commit: null })
          try {
            const data = await fetchJson(withRepo('api/git-history.commit?hash=' + encodeURIComponent(hash), repo))
            DETAIL_CACHE.set(cacheKey, data.commit)
            // 详情带 patch，最多保留 20 条，避免长时间使用把内存撑大。
            if (DETAIL_CACHE.size > 20) {
              const oldest = DETAIL_CACHE.keys().next().value
              if (oldest !== undefined) DETAIL_CACHE.delete(oldest)
            }
            if (alive.current) setState({ loading: false, error: '', commit: data.commit })
          } catch (error) {
            if (alive.current) setState({ loading: false, error: String(error.message || error), commit: null })
          }
        },
        [hash, repo]
      )

      useEffect(() => {
        alive.current = true
        load(false)
        return () => {
          alive.current = false
        }
      }, [load])

      const commit = state.commit
      const sections = useMemo(() => (commit ? parsePatch(commit.patch || '') : []), [commit])

      const sectionFor = useCallback(
        (filePath) =>
          sections.find(
            (section) =>
              section.path === filePath || section.path.endsWith(filePath) || filePath.endsWith(section.path)
          ),
        [sections]
      )

      const scrollToFile = useCallback(
        (filePath) => {
          const section = sectionFor(filePath)
          const el = section && sectionRefs.current[section.path]
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        },
        [sectionFor]
      )

      const copyHash = useCallback(() => {
        const text = commit ? commit.hash : hash
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            },
            () => {}
          )
        }
      }, [commit, hash])

      const files = commit ? commit.files : []
      const shownFiles = files.slice(0, 40)

      return h(
        'div',
        { style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 10px' } },
        state.loading && h('div', { style: { color: C.muted, fontSize: 12 } }, tr('loading')),
        state.error &&
          h(
            'div',
            { style: { color: C.text, fontSize: 12 } },
            h('div', null, tr('error')),
            h('div', { style: { color: C.muted, margin: '4px 0 8px', wordBreak: 'break-word' } }, state.error),
            h(Button, { onClick: () => load(true) }, tr('retry'))
          ),
        commit &&
          h(
            'div',
            null,
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' } },
              h('div', { style: { flex: 1, minWidth: 120, fontWeight: 700, fontSize: 13, color: C.text } }, commit.subject),
              h(RefChips, { refs: commit.refs })
            ),
            h(
              'div',
              { style: { fontSize: 11, color: C.muted, lineHeight: '17px' } },
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h('span', { style: { fontFamily: MONO } }, commit.short),
                h(Button, { onClick: copyHash, title: tr('copyHash') }, copied ? tr('copied') : tr('copyHash')),
                Array.isArray(commit.parents) && commit.parents.length > 1
                  ? h(Chip, { title: tr('mergeCommit') }, tr('mergeCommit'))
                  : null,
                h('span', null, `${commit.author}${commit.authorEmail ? ' <' + commit.authorEmail + '>' : ''}`)
              ),
              h('div', null, fmtDate(commit.authorDate)),
              commit.committer && commit.committer !== commit.author
                ? h('div', null, `committed by ${commit.committer} · ${fmtDate(commit.commitDate)}`)
                : null
            ),
            commit.body
              ? h(
                  'pre',
                  {
                    style: {
                      margin: '8px 0 0',
                      padding: '6px 8px',
                      background: C.code,
                      border: '1px solid ' + C.border,
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: '16px',
                      whiteSpace: 'pre-wrap',
                      color: C.text,
                      fontFamily: 'inherit',
                    },
                  },
                  commit.body
                )
              : null,
            h(
              'div',
              { style: { marginTop: 12, marginBottom: 4, fontSize: 12, fontWeight: 600, color: C.text } },
              `${tr('files')} (${files.length})`
            ),
            h(
              'div',
              { style: { border: '1px solid ' + C.border, borderRadius: 6, overflow: 'hidden' } },
              shownFiles.length === 0
                ? h('div', { style: { padding: '6px 8px', fontSize: 11, color: C.muted } }, '—')
                : shownFiles.map((file, i) =>
                    h(
                      'div',
                      {
                        key: file.path + i,
                        onClick: () => scrollToFile(file.path),
                        title: file.path,
                        style: {
                          display: 'flex',
                          gap: 8,
                          padding: '3px 8px',
                          fontSize: 11,
                          borderTop: i === 0 ? 'none' : '1px solid ' + C.border,
                          fontFamily: MONO,
                          cursor: 'pointer',
                        },
                      },
                      h(
                        'span',
                        {
                          style: {
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: C.text,
                          },
                        },
                        file.path
                      ),
                      file.binary
                        ? h('span', { style: { color: C.muted } }, 'bin')
                        : h(
                            'span',
                            { style: { color: C.muted, whiteSpace: 'nowrap' } },
                            h('span', { style: { color: C.add } }, `+${file.additions}`),
                            ' ',
                            h('span', { style: { color: C.del } }, `-${file.deletions}`)
                          )
                    )
                  ),
              files.length > shownFiles.length
                ? h(
                    'div',
                    { style: { padding: '3px 8px', fontSize: 11, color: C.muted, borderTop: '1px solid ' + C.border } },
                    fill(tr('moreFiles'), files.length - shownFiles.length)
                  )
                : null
            ),
            sections.length > 0
              ? h(PatchView, { sections, sectionRefs, tr })
              : h(
                  'pre',
                  {
                    style: {
                      margin: '10px 0 0',
                      padding: '8px',
                      background: C.code,
                      border: '1px solid ' + C.border,
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: '15px',
                      whiteSpace: 'pre',
                      overflow: 'auto',
                      color: C.text,
                      fontFamily: MONO,
                    },
                  },
                  commit.patch || tr('noPatch')
                ),
            commit.patchTruncated
              ? h('div', { style: { marginTop: 6, fontSize: 11, color: C.muted } }, tr('truncated'))
              : null,
            h(
              'div',
              { style: { marginTop: 12, display: 'flex', gap: 6 } },
              h(Button, { onClick: () => load(true) }, tr('retry')),
              h(Button, { onClick: onRefresh }, tr('refresh'))
            )
          )
      )
    }

    function GitPanel(props) {
      const tr = typeof props.t === 'function' ? props.t : (key) => key
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null
      const visible = !info || !info.tab || info.tab.visible !== false

      const [log, setLog] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [query, setQuery] = useState('')
      const [selected, setSelected] = useState(null)
      const [limit, setLimit] = useState(PAGE)
      const [activeHash, setActiveHash] = useState('')
      const [repo, setRepo] = useState(() => readStored(REPO_KEY))
      const [repoDraft, setRepoDraft] = useState(() => readStored(REPO_KEY))
      const [recent, setRecent] = useState(() => readRecent())
      const [editingRepo, setEditingRepo] = useState(false)
      const [repoError, setRepoError] = useState('')
      const [suggestions, setSuggestions] = useState([])
      const [usingDetected, setUsingDetected] = useState(false)
      const [ready, setReady] = useState(false)
      const sessionId = props.sessionId || ''
      const autoOpenedRepo = useRef(false)
      const abortRef = useRef(null)
      const searchRef = useRef(null)
      const rowRefs = useRef({})
      const listRef = useRef(null)

      const refresh = useCallback(async () => {
        if (!repo) {
          setLoading(false)
          return
        }
        if (abortRef.current) abortRef.current.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setLoading(true)
        setError('')
        try {
          const data = await fetchJson(withRepo('api/git-history.log?limit=' + limit, repo), controller.signal)
          if (!controller.signal.aborted) {
            setLog(data)
            setLoading(false)
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            setError(String(cause.message || cause))
            setLoading(false)
          }
        }
      }, [limit, repo])

      // 打开面板先问宿主：当前会话属于哪个工作区、哪些工作区是 git 仓库。
      useEffect(() => {
        let cancelled = false
        const query = sessionId ? '?session=' + encodeURIComponent(sessionId) : ''
        // 旧版本可能把非法输入存进了 localStorage，这里清掉，避免一直报错。
        const storedRaw = readStored(REPO_KEY)
        const stored = absolutePath(storedRaw)
        if (storedRaw && !stored) {
          writeStored(REPO_KEY, '')
          setRepo('')
          setRepoDraft('')
        }
        fetchJson('api/git-history.defaults' + query)
          .then((data) => {
            if (cancelled) return
            setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
            if (!stored) {
              if (data.detected) {
                setRepo(data.detected)
                setRepoDraft(data.detected)
                setUsingDetected(true)
              } else {
                setEditingRepo(true)
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            if (!cancelled) setReady(true)
          })
        return () => {
          cancelled = true
        }
      }, [sessionId])

      useEffect(() => {
        if (visible && ready && repo) refresh()
        return () => {
          if (abortRef.current) abortRef.current.abort()
        }
      }, [visible, ready, repo, refresh])

      // 严格按日期倒序：git 的默认顺序（含 --graph）会为了保持泳道连续而把旧提交排到新提交上面。
      const sortedCommits = useMemo(() => {
        const list = log && Array.isArray(log.commits) ? log.commits.slice() : []
        list.sort((a, b) => {
          const ta = Date.parse(a.authorDate) || 0
          const tb = Date.parse(b.authorDate) || 0
          return tb - ta
        })
        return list
      }, [log])

      const graph = useMemo(() => buildGraph(sortedCommits), [sortedCommits])

      const commits = useMemo(() => {
        const items = sortedCommits.map((commit, index) => ({ commit, row: graph.rows[index], index }))
        const q = query.trim().toLowerCase()
        if (!q) return items
        return items.filter(
          ({ commit }) =>
            commit.subject.toLowerCase().includes(q) ||
            commit.author.toLowerCase().includes(q) ||
            commit.short.toLowerCase().includes(q)
        )
      }, [sortedCommits, graph, query])

      const showGraph = query.trim() === ''
      const canLoadMore = Boolean(log) && sortedCommits.length >= limit && limit < MAX_PAGE
      const activeIndex = commits.findIndex((item) => item.commit.hash === activeHash)

      const onOpen = useCallback((hash) => setSelected(hash), [])
      const onBack = useCallback(() => setSelected(null), [])

      const applyRepo = useCallback(() => {
        const value = absolutePath(repoDraft)
        if (!value) {
          setRepoError(tr('repoMustBeAbsolute'))
          return
        }
        setRepoError('')
        writeStored(REPO_KEY, value)
        setRepo(value)
        setRecent(rememberRepo(value))
        setEditingRepo(false)
        setSelected(null)
        setUsingDetected(false)
        autoOpenedRepo.current = true
      }, [repoDraft, tr])

      const pickRepo = useCallback(
        (value) => {
          const next = absolutePath(value)
          if (!next) {
            setRepoError(tr('repoMustBeAbsolute'))
            return
          }
          setRepoError('')
          setRepoDraft(next)
          writeStored(REPO_KEY, next)
          setRepo(next)
          setRecent(rememberRepo(next))
          setEditingRepo(false)
          setSelected(null)
          setUsingDetected(false)
          autoOpenedRepo.current = true
        },
        [tr]
      )

      const clearRepo = useCallback(() => {
        writeStored(REPO_KEY, '')
        setRepoDraft('')
        setRepo('')
        setRecent(readRecent())
        setSelected(null)
        setRepoError('')
        setUsingDetected(false)
      }, [])

      useEffect(() => {
        if (error && /not a git repository|must be absolute/i.test(error) && !autoOpenedRepo.current) {
          autoOpenedRepo.current = true
          setEditingRepo(true)
        }
      }, [error])

      const moveSelection = useCallback(
        (delta) => {
          if (commits.length === 0) return
          const next = Math.min(Math.max(activeIndex + delta, 0), commits.length - 1)
          const item = commits[next]
          setActiveHash(item.commit.hash)
          const el = rowRefs.current[item.commit.hash]
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
        },
        [activeIndex, commits]
      )

      const onKeyDown = useCallback(
        (e) => {
          const tag = e.target && e.target.tagName
          const typing = tag === 'INPUT' || tag === 'TEXTAREA'
          if (e.key === 'Escape') {
            if (selected) {
              e.stopPropagation()
              onBack()
            } else if (typing) {
              e.target.blur()
            }
            return
          }
          if (selected || typing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            moveSelection(e.key === 'ArrowDown' ? 1 : -1)
            return
          }
          if (e.key === 'Enter' && activeHash) {
            e.preventDefault()
            onOpen(activeHash)
            return
          }
          if (e.key === 'r') {
            e.preventDefault()
            refresh()
            return
          }
          if (e.key === '/') {
            e.preventDefault()
            if (searchRef.current && searchRef.current.focus) searchRef.current.focus()
          }
        },
        [selected, onBack, moveSelection, activeHash, onOpen, refresh]
      )

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            fontSize: 12,
            color: C.text,
          },
          onKeyDown,
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 8px',
              borderBottom: '1px solid ' + C.border,
              flexWrap: 'wrap',
            },
          },
          selected ? h(Button, { onClick: onBack, title: tr('back') }, '‹') : null,
          h(
            'span',
            {
              style: {
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 160,
              },
              title: log ? log.repo : repo || '',
            },
            log
              ? log.name
              : repo
                ? repo.split(/[\\/]/).filter(Boolean).pop() || repo
                : 'git'
          ),
          log && log.detached
            ? h(Chip, { accent: true, title: tr('detached') }, log.branch || tr('detached'))
            : log && log.branch
              ? h(Chip, { accent: true, title: log.branch }, log.branch)
              : null,
          usingDetected && repo ? h(Chip, { title: repo }, tr('detectedRepo')) : null,
          log && log.ahead ? h(Chip, { title: tr('ahead') }, '↑' + log.ahead) : null,
          log && log.behind ? h(Chip, { title: tr('behind') }, '↓' + log.behind) : null,
          log && log.dirty ? h(Chip, { title: tr('dirty') }, '● ' + log.dirty) : null,
          h('div', { style: { flex: 1 } }),
          h(
            Button,
            {
              onClick: () => {
                setRepoDraft(repo)
                setEditingRepo((value) => !value)
              },
              title: tr('chooseRepo'),
            },
            '⌂'
          ),
          h(Button, { onClick: refresh, title: tr('refresh') }, '↻')
        ),
        editingRepo
          ? h(
              'div',
              {
                style: {
                  padding: '6px 8px',
                  borderBottom: '1px solid ' + C.border,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                },
              },
              h(
                'div',
                { style: { display: 'flex', gap: 6 } },
                h('input', {
                  value: repoDraft,
                  autoFocus: true,
                  onChange: (e) => setRepoDraft(e.target.value),
                  placeholder: tr('repoPlaceholder'),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applyRepo()
                    } else if (e.key === 'Escape') {
                      setEditingRepo(false)
                    }
                  },
                  style: {
                    flex: 1,
                    minWidth: 0,
                    background: 'transparent',
                    border: '1px solid ' + C.border,
                    borderRadius: 5,
                    color: C.text,
                    fontFamily: MONO,
                    fontSize: 11,
                    lineHeight: '18px',
                    padding: '2px 6px',
                    outline: 'none',
                  },
                }),
                h(Button, { onClick: applyRepo }, tr('applyRepo')),
                h(Button, { onClick: clearRepo, title: tr('clearRepo') }, tr('clearRepo'))
              ),
              repoError ? h('div', { style: { fontSize: 11, color: C.del } }, repoError) : null,
              suggestions.length
                ? h(
                    'div',
                    { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
                    h('span', { style: { fontSize: 10, color: C.muted } }, tr('workspaceList')),
                    suggestions.map((item) =>
                      h(
                        'button',
                        {
                          key: item.path,
                          type: 'button',
                          onClick: () => pickRepo(item.path),
                          title: item.path,
                          style: {
                            appearance: 'none',
                            cursor: 'pointer',
                            background: 'transparent',
                            border: '1px solid ' + C.accent,
                            color: C.accent,
                            borderRadius: 4,
                            fontSize: 10,
                            lineHeight: '16px',
                            padding: '0 5px',
                            fontFamily: 'inherit',
                          },
                        },
                        item.title || item.path
                      )
                    )
                  )
                : null,
              recent.length
                ? h(
                    'div',
                    { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                    recent.map((item, index) =>
                      h(
                        'button',
                        {
                          key: item + index,
                          type: 'button',
                          onClick: () => pickRepo(item),
                          title: item,
                          style: {
                            appearance: 'none',
                            cursor: 'pointer',
                            background: 'transparent',
                            border: '1px solid ' + C.border,
                            color: C.muted,
                            borderRadius: 4,
                            fontSize: 10,
                            lineHeight: '16px',
                            padding: '0 5px',
                            fontFamily: 'inherit',
                          },
                        },
                        item.split(/[\\/]/).filter(Boolean).pop() || item
                      )
                    )
                  )
                : null
            )
          : null,
        selected
          ? h(DetailView, { tr, hash: selected, repo, onBack, onRefresh: refresh })
          : h(
              'div',
              { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
              h(
                'div',
                { style: { padding: '6px 8px', borderBottom: '1px solid ' + C.border } },
                h('input', {
                  ref: searchRef,
                  value: query,
                  onChange: (e) => setQuery(e.target.value),
                  placeholder: tr('search'),
                  style: {
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'transparent',
                    border: '1px solid ' + C.border,
                    borderRadius: 5,
                    color: C.text,
                    fontFamily: 'inherit',
                    fontSize: 11,
                    lineHeight: '18px',
                    padding: '2px 6px',
                    outline: 'none',
                  },
                })
              ),
              h(
                'div',
                { ref: listRef, tabIndex: -1, style: { flex: 1, minHeight: 0, overflow: 'auto', outline: 'none' } },
                !repo && ready
                  ? h('div', { style: { padding: '10px 8px', color: C.muted } }, tr('needRepo'))
                  : null,
                repo && loading && h('div', { style: { padding: '10px 8px', color: C.muted } }, tr('loading')),
                repo && !loading && error
                  ? h(
                      'div',
                      { style: { padding: '10px 8px' } },
                      h('div', { style: { color: C.text } }, tr('error')),
                      h('div', { style: { color: C.muted, margin: '4px 0 8px', wordBreak: 'break-word' } }, error),
                      h(Button, { onClick: refresh }, tr('retry'))
                    )
                  : null,
                repo && !loading && !error && commits.length === 0
                  ? h('div', { style: { padding: '10px 8px', color: C.muted } }, log && log.commits ? tr('empty') : '')
                  : null,
                repo && !loading && !error
                  ? (() => {
                      const out = []
                      let lastDay = ''
                      for (const item of commits) {
                        const day = dayKey(item.commit.authorDate)
                        if (showGraph && day && day !== lastDay) {
                          out.push(
                            h(
                              'div',
                              {
                                key: 'day-' + day + '-' + item.index,
                                style: {
                                  position: 'sticky',
                                  top: 0,
                                  zIndex: 1,
                                  padding: '4px 8px',
                                  fontSize: 10,
                                  letterSpacing: '.02em',
                                  color: C.muted,
                                  background: C.base,
                                  borderBottom: '1px solid ' + C.border,
                                },
                              },
                              day
                            )
                          )
                          lastDay = day
                        }
                        out.push(
                          h(CommitRow, {
                            key: item.commit.hash,
                            commit: item.commit,
                            row: item.row,
                            laneCount: graph.laneCount,
                            active: item.commit.hash === activeHash,
                            showGraph,
                            onOpen,
                            registerRef: (el) => {
                              if (el) rowRefs.current[item.commit.hash] = el
                            },
                            tr,
                          })
                        )
                      }
                      if (canLoadMore) {
                        out.push(
                          h(
                            'div',
                            { key: 'load-more', style: { padding: '8px', display: 'flex', justifyContent: 'center' } },
                            h(Button, { onClick: () => setLimit((value) => Math.min(value + PAGE, MAX_PAGE)) }, tr('loadMore'))
                          )
                        )
                      }
                      return out
                    })()
                  : null
              ),
              h(
                'div',
                {
                  style: {
                    padding: '2px 8px 4px',
                    fontSize: 10,
                    color: C.muted,
                    borderTop: '1px solid ' + C.border,
                  },
                },
                tr('keyboard')
              )
            )
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-history: locale')

        const t = ctx.locale.bind(NS)

        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              title: () => t('tab.title'),
              guide: [
                {
                  id: 'git-history',
                  order: 10,
                  title: () => t('guide.title'),
                  description: () => t('guide.description'),
                },
              ],
            }),
          'git-history: tab type'
        )

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS }, GitPanel)
            ),
          'git-history: body'
        )
      },
    }
  },
})

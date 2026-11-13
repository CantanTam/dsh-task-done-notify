/**
 * dsh-task-done-notify — host half.
 *
 * On every finished turn (success, error or abort) it sends one OS-level
 * desktop notification. On KDE that is the critical-urgency style: the orange
 * stripe on the left, kept on screen until the user dismisses it.
 *
 * There is no in-app popup and no browser half: the notification is global and
 * lives entirely in the host process.
 */

import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const name = 'desktop-notify'

const DEFAULTS = Object.freeze({
  /** Master switch. */
  enabled: true,
  /** Skip the notification while the DeepSeek Harness window is focused. */
  skipWhenFocused: true,
  /** Also notify when a subagent session finishes. */
  notifySubagents: false,
  /** Follow up once background jobs started during the turn have settled. */
  notifyJobsSettled: true,
  /** Maximum characters of the user prompt echoed in the notification. */
  taskMaxChars: 60,
  /** App name shown in the notification header. */
  appName: 'DeepSeek Harness',
  /** Linux desktop-entry basename; KDE keys its per-app policy on it. */
  desktopEntry: 'deepseek-harness',
  /** Icon theme name or file path for the Linux notification. */
  icon: 'deepseek-harness',
  /** Timeout in milliseconds; 0 keeps the notification until dismissed. */
  systemExpireMs: 0,
})

const REASONS = Object.freeze({
  completed: { tone: 'success', title: '任务完成' },
  blocked: { tone: 'warn', title: '等待处理' },
  aborted: { tone: 'warn', title: '任务已中止' },
  interrupted: { tone: 'warn', title: '任务已中断' },
  error: { tone: 'error', title: '任务出错' },
  'max-tokens': { tone: 'error', title: '任务输出被截断' },
})

/** Format a duration in milliseconds as a compact Chinese phrase. */
export function formatDuration(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0
  if (value < 1000) return '不到 1 秒'
  const seconds = Math.round(value / 1000)
  if (seconds < 60) return seconds + ' 秒'
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  if (minutes < 60) return restSeconds === 0 ? minutes + ' 分钟' : minutes + ' 分 ' + restSeconds + ' 秒'
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? hours + ' 小时' : hours + ' 小时 ' + restMinutes + ' 分'
}

/** Map a turn/end reason onto title and tone. */
export function describeReason(reason) {
  const kind = reason && typeof reason === 'object' ? reason.kind : undefined
  return REASONS[kind] ?? { tone: 'info', title: '任务已结束' }
}

/** Collapse whitespace and cut a long prompt down to one short line. */
export function summarize(text, maxChars = 60) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const limit = Math.max(4, Math.trunc(maxChars) || 60)
  if (normalized.length <= limit) return normalized
  return normalized.slice(0, limit - 1).trimEnd() + '…'
}

function pickInt(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function pickString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** Merge user config over the defaults. */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: source.enabled !== false,
    skipWhenFocused: source.skipWhenFocused !== false,
    notifySubagents: source.notifySubagents === true,
    notifyJobsSettled: source.notifyJobsSettled !== false,
    taskMaxChars: pickInt(source.taskMaxChars, 12, 240, DEFAULTS.taskMaxChars),
    appName: pickString(source.appName, DEFAULTS.appName),
    desktopEntry: pickString(source.desktopEntry, DEFAULTS.desktopEntry),
    icon: typeof source.icon === 'string' ? source.icon.trim() : DEFAULTS.icon,
    systemExpireMs: pickInt(source.systemExpireMs, 0, 86400000, DEFAULTS.systemExpireMs),
  }
}

/** Build the notification payload for a finished turn. */
export function buildTurnNotification({
  config,
  reason,
  task = '',
  sessionTitle = '',
  durationMs = 0,
  steps = 0,
  jobsRunning = 0,
  errorText = '',
}) {
  const info = describeReason(reason)
  const heading = sessionTitle && !task.includes(sessionTitle) ? summarize(sessionTitle, 80) : ''
  const meta = ['用时 ' + formatDuration(durationMs)]
  if (steps > 0) meta.push(steps + ' 步')
  if (jobsRunning > 0) meta.push('另有 ' + jobsRunning + ' 个后台任务运行中')
  return {
    title: info.title,
    tone: info.tone,
    heading,
    task: task ? summarize(task, config.taskMaxChars) : '',
    meta: meta.join(' · '),
    error: errorText ? summarize(errorText, 160) : '',
  }
}

/** Build the payload for background jobs that outlived the turn. */
export function buildJobsSettledNotification({ config, task = '', sessionTitle = '', durationMs = 0, jobs = 0, failures = 0 }) {
  const heading = sessionTitle && !task.includes(sessionTitle) ? summarize(sessionTitle, 80) : ''
  const count = jobs > 0 ? jobs + ' 个后台任务已全部结束' : '后台任务已全部结束'
  const suffix = failures > 0 ? '（' + failures + ' 个失败）' : ''
  return {
    title: failures > 0 ? '后台任务结束（有失败）' : '后台任务已结束',
    tone: failures > 0 ? 'error' : 'success',
    heading,
    task: task ? summarize(task, config.taskMaxChars) : '',
    meta: count + suffix + ' · 总用时 ' + formatDuration(durationMs),
    error: '',
  }
}

function notificationText(payload) {
  return [payload.heading, payload.task, payload.meta, payload.error ? '错误：' + payload.error : '']
    .filter((line) => typeof line === 'string' && line.length > 0)
    .join('\n')
}

function appleScriptString(text) {
  const escaped = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  return '"' + escaped + '"'
}

function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function powershellQuote(text) {
  return "'" + String(text).replace(/'/g, "''") + "'"
}

function windowsToastScript(title, body) {
  const xml = '<toast><visual><binding template="ToastGeneric"><text>' + xmlEscape(title) + '</text><text>' + xmlEscape(body) + '</text></binding></visual></toast>'
  const appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml(' + powershellQuote(xml) + ')',
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(' + powershellQuote(appId) + ').Show($toast)',
  ].join('; ')
}

/**
 * Build the platform command for the OS-level notification. Always critical
 * urgency on Linux: the orange stripe style, kept until dismissed.
 */
export function buildSystemNotification(config, payload, platform = process.platform) {
  const title = payload.title || '任务已结束'
  const body = notificationText(payload) || title
  if (platform === 'linux') {
    const args = ['-a', config.appName, '-u', 'critical', '-t', String(config.systemExpireMs)]
    if (config.icon) args.push('-i', config.icon)
    args.push('-h', 'string:desktop-entry:' + config.desktopEntry, '-A', 'default=关闭', title, body)
    return { command: 'notify-send', args }
  }
  if (platform === 'darwin') {
    return { command: 'osascript', args: ['-e', 'display notification ' + appleScriptString(body) + ' with title ' + appleScriptString(title)] }
  }
  if (platform === 'win32') {
    const script = windowsToastScript(title, body)
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] }
  }
  return null
}

/** Fire-and-forget delivery; a broken notifier never disturbs session events. */
export function deliverSystemNotification(config, payload, warn, platform = process.platform, spawnProcess = spawn) {
  let built
  try {
    built = buildSystemNotification(config, payload, platform)
  } catch (error) {
    warn('system notification build failed: ' + (error && error.message ? error.message : error))
    return
  }
  if (built === null) return
  try {
    const child = spawnProcess(built.command, built.args, { stdio: 'ignore', detached: true })
    if (child && typeof child.on === 'function') child.on('error', (error) => warn('system notification failed: ' + (error && error.message ? error.message : error)))
    if (child && typeof child.unref === 'function') child.unref()
  } catch (error) {
    warn('system notification failed: ' + (error && error.message ? error.message : error))
  }
}

function userText(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .trim()
}

/** Read historical events when the plugin mounted mid-session. */
function scanSession(session, turn) {
  const facts = { startedAt: 0, task: '', title: '', steps: 0 }
  let events
  try {
    if (typeof session?.snapshotEvents !== 'function') return facts
    events = session.snapshotEvents()
  } catch {
    return facts
  }
  let insideTurn = false
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'session/title' && typeof event.data?.title === 'string') facts.title = event.data.title
    if (event.type === 'turn/start' && event.data?.turn === turn) {
      facts.startedAt = event.time
      facts.steps = 0
      insideTurn = true
      continue
    }
    if (!insideTurn) continue
    if (event.type === 'step/start' && event.data?.turn === turn) facts.steps += 1
    else if (event.type === 'user/message' && event.data?.source?.kind === 'user') facts.task = userText(event.data)
  }
  return facts
}

/** Walk /proc upward from this process and check whether pid is an ancestor. */
function isAncestorPid(pid) {
  let current = process.pid
  const seen = new Set()
  while (current > 1 && !seen.has(current)) {
    if (current === pid) return true
    seen.add(current)
    try {
      const stat = readFileSync('/proc/' + current + '/stat', 'utf8')
      const end = stat.lastIndexOf(')')
      current = Number(stat.slice(end + 2).split(' ')[1])
    } catch {
      return false
    }
  }
  return false
}

function xpropValue(windowId, property) {
  try {
    return execFileSync('xprop', ['-id', windowId, property], { timeout: 500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/**
 * True when the active X11 window belongs to DeepSeek Harness: the desktop
 * app's own window (WM_CLASS or owning process) or a browser window whose
 * title carries the app name. Fails open on Wayland, missing tools or any
 * error, so the notification is still sent.
 */
export function harnessWindowFocused() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false
  try {
    const active = execFileSync('xdotool', ['getactivewindow'], { timeout: 500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!active) return false
    let title = ''
    try {
      title = execFileSync('xdotool', ['getwindowname', active], { timeout: 500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      title = ''
    }
    if (title.includes('DeepSeek Harness')) return true
    if (/deepseek-harness/i.test(xpropValue(active, 'WM_CLASS'))) return true
    const pidMatch = xpropValue(active, '_NET_WM_PID').match(/(\d+)\s*$/)
    if (pidMatch && isAncestorPid(Number(pidMatch[1]))) return true
    return false
  } catch {
    return false
  }
}

/** Plugin entry point. `deps.spawn` and `deps.isFocused` are test seams. */
export function apply(ctx, rawConfig, deps = {}) {
  const config = normalizeConfig(rawConfig)
  const spawnProcess = typeof deps.spawn === 'function' ? deps.spawn : spawn
  const isFocused = typeof deps.isFocused === 'function' ? deps.isFocused : harnessWindowFocused
  let logger
  try {
    logger = typeof ctx.logger === 'function' ? ctx.logger(name) : undefined
  } catch {
    logger = undefined
  }
  const warn = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      /* logging must never break event delivery */
    }
  }

  if (!config.enabled) {
    warn('dsh-desktop-notify: disabled by config')
    return
  }

  const state = new Map()

  const sessionState = (session) => {
    const id = session?.id
    let entry = state.get(id)
    if (!entry) {
      entry = {
        turn: undefined,
        startedAt: 0,
        steps: 0,
        task: '',
        title: '',
        jobs: new Set(),
        pending: null,
        notifiedTurn: undefined,
      }
      state.set(id, entry)
    }
    return entry
  }

  const notifiable = (session) => {
    if (config.notifySubagents) return true
    return session?.header?.origin !== 'subagent'
  }

  const notify = (payload) => {
    if (config.skipWhenFocused) {
      let focused = false
      try {
        focused = isFocused() === true
      } catch {
        focused = false
      }
      if (focused) {
        warn('dsh-task-done-notify: window focused, notification skipped')
        return
      }
    }
    deliverSystemNotification(config, payload, warn, process.platform, spawnProcess)
  }

  const onSessionEvent = (session, event) => {
    try {
      if (!session || !event || typeof event.type !== 'string') return
      if (!notifiable(session)) return
      const entry = sessionState(session)

      switch (event.type) {
        case 'turn/start': {
          entry.turn = event.data?.turn
          entry.startedAt = event.time
          entry.steps = 0
          entry.task = ''
          return
        }
        case 'step/start': {
          if (entry.turn === event.data?.turn) entry.steps += 1
          return
        }
        case 'user/message': {
          if (event.data?.source?.kind === 'user') entry.task = userText(event.data)
          return
        }
        case 'session/title': {
          if (typeof event.data?.title === 'string') entry.title = event.data.title
          return
        }
        case 'job/registered': {
          if (event.data?.jobId !== undefined) entry.jobs.add(String(event.data.jobId))
          return
        }
        case 'job/settled': {
          if (event.data?.jobId !== undefined) entry.jobs.delete(String(event.data.jobId))
          if (entry.pending) {
            if (event.data?.status === 'failed') entry.pending.failures += 1
            if (entry.jobs.size === 0) {
              const pending = entry.pending
              entry.pending = null
              notify(
                buildJobsSettledNotification({
                  config,
                  task: pending.task,
                  sessionTitle: pending.title,
                  durationMs: Math.max(0, event.time - pending.startedAt),
                  jobs: pending.jobs,
                  failures: pending.failures,
                }),
              )
            }
          }
          return
        }
        case 'turn/end': {
          const turn = event.data?.turn
          if (entry.notifiedTurn === turn) return
          const reason = event.data?.reason
          entry.notifiedTurn = turn
          if (reason && reason.kind === 'forked') return

          let startedAt = entry.startedAt
          let task = entry.task
          let title = entry.title
          let steps = entry.steps
          const missed = entry.turn !== turn || !startedAt || !task
          if (missed) {
            const facts = scanSession(session, turn)
            if (entry.turn !== turn || !startedAt) startedAt = facts.startedAt || event.time
            if (!task) task = facts.task
            if (!title) title = facts.title
            if (entry.turn !== turn) steps = facts.steps
            else if (!steps) steps = facts.steps
          } else if (!title) {
            title = scanSession(session, turn).title
          }

          const jobsRunning = entry.jobs.size
          const errorText = reason && reason.kind === 'error' && reason.error ? reason.error.message || '' : ''
          notify(
            buildTurnNotification({
              config,
              reason,
              task,
              sessionTitle: title,
              durationMs: Math.max(0, event.time - (startedAt || event.time)),
              steps,
              jobsRunning,
              errorText,
            }),
          )

          entry.turn = undefined
          entry.startedAt = 0
          entry.steps = 0
          entry.task = ''
          if (config.notifyJobsSettled && jobsRunning > 0) {
            entry.pending = {
              startedAt: startedAt || event.time,
              task,
              title,
              jobs: jobsRunning,
              failures: 0,
            }
          }
          return
        }
        default:
          return
      }
    } catch (error) {
      warn('session event handling failed: ' + (error && error.message ? error.message : error))
    }
  }

  ctx.on('session/event', onSessionEvent)
}

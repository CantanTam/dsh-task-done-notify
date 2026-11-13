import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  apply,
  buildJobsSettledNotification,
  buildSystemNotification,
  buildTurnNotification,
  describeReason,
  formatDuration,
  normalizeConfig,
  summarize,
} from '../index.js'

function fakeCtx() {
  const handlers = new Map()
  const ctx = {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return () => {
        const list = handlers.get(event) || []
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
    logger() {
      return { warn() {}, info() {} }
    },
  }
  const emit = (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) handler(...args)
  }
  return { ctx, emit }
}

function fakeSpawn() {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    return { on() {}, unref() {} }
  }
  return { calls, spawn }
}

function makeSession(id, header = {}) {
  return { id, header: { id, ...header }, snapshotEvents: () => [] }
}

test('formatDuration', () => {
  assert.equal(formatDuration(0), '不到 1 秒')
  assert.equal(formatDuration(999), '不到 1 秒')
  assert.equal(formatDuration(1000), '1 秒')
  assert.equal(formatDuration(59_000), '59 秒')
  assert.equal(formatDuration(60_000), '1 分钟')
  assert.equal(formatDuration(65_000), '1 分 5 秒')
  assert.equal(formatDuration(3_600_000), '1 小时')
  assert.equal(formatDuration(3_900_000), '1 小时 5 分')
})

test('describeReason maps every turn end kind onto a tone', () => {
  assert.deepEqual(describeReason({ kind: 'completed' }), { tone: 'success', title: '任务完成' })
  assert.equal(describeReason({ kind: 'error' }).tone, 'error')
  assert.equal(describeReason({ kind: 'max-tokens' }).tone, 'error')
  assert.equal(describeReason({ kind: 'aborted' }).tone, 'warn')
  assert.equal(describeReason({ kind: 'interrupted' }).tone, 'warn')
  assert.equal(describeReason({ kind: 'blocked' }).tone, 'warn')
  assert.equal(describeReason({ kind: 'forked' }).tone, 'info')
  assert.equal(describeReason(undefined).title, '任务已结束')
})

test('summarize collapses whitespace and truncates', () => {
  assert.equal(summarize('  a\n\n b  '), 'a b')
  assert.equal(summarize('x'.repeat(80), 20), 'x'.repeat(19) + '…')
  assert.equal(summarize('', 20), '')
})

test('normalizeConfig clamps bad input', () => {
  const config = normalizeConfig({ taskMaxChars: 9999, notifyJobsSettled: 'yes' })
  assert.equal(config.taskMaxChars, 240)
  assert.equal(config.notifyJobsSettled, true)
  assert.equal(config.notifySubagents, false)
  assert.equal(config.desktopEntry, 'deepseek-harness')
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
})

test('turn payload carries title, tone, heading, task, meta and error', () => {
  const config = normalizeConfig({})
  const payload = buildTurnNotification({
    config,
    reason: { kind: 'completed' },
    task: '帮我写一个通知插件',
    sessionTitle: '开发记录',
    durationMs: 65_000,
    steps: 3,
  })
  assert.equal(payload.title, '任务完成')
  assert.equal(payload.tone, 'success')
  assert.equal(payload.heading, '开发记录')
  assert.equal(payload.task, '帮我写一个通知插件')
  assert.equal(payload.meta, '用时 1 分 5 秒 · 3 步')
  assert.equal(payload.error, '')

  const failed = buildTurnNotification({
    config,
    reason: { kind: 'error' },
    task: '跑一下构建',
    durationMs: 5_000,
    errorText: 'provider returned 503',
  })
  assert.equal(failed.tone, 'error')
  assert.equal(failed.error, 'provider returned 503')

  const duplicated = buildTurnNotification({
    config,
    reason: { kind: 'completed' },
    task: '帮我写一个通知插件',
    sessionTitle: '通知插件',
    durationMs: 5_000,
  })
  assert.equal(duplicated.heading, '')
})

test('background job payload reports counts and failures', () => {
  const config = normalizeConfig({})
  const payload = buildJobsSettledNotification({
    config,
    task: '编译整个项目',
    durationMs: 34_000,
    jobs: 2,
    failures: 1,
  })
  assert.equal(payload.title, '后台任务结束（有失败）')
  assert.equal(payload.tone, 'error')
  assert.equal(payload.meta, '2 个后台任务已全部结束（1 个失败） · 总用时 34 秒')
})

test('linux notification is always critical and carries the desktop-entry hint', () => {
  const config = normalizeConfig({})
  const built = buildSystemNotification(
    config,
    { title: '任务完成', tone: 'success', heading: '开发记录', task: '修一个 bug', meta: '用时 3 秒', error: '' },
    'linux',
  )
  assert.equal(built.command, 'notify-send')
  assert.equal(built.args[built.args.indexOf('-u') + 1], 'critical')
  assert.equal(built.args[built.args.indexOf('-h') + 1], 'string:desktop-entry:deepseek-harness')
  assert.equal(built.args[built.args.indexOf('-i') + 1], 'deepseek-harness')
  assert.equal(built.args[built.args.indexOf('-t') + 1], '0')
  assert.equal(built.args[built.args.length - 2], '任务完成')
  assert.equal(built.args[built.args.length - 1], '开发记录\n修一个 bug\n用时 3 秒')
})

test('macOS and Windows commands stay usable', () => {
  const config = normalizeConfig({})
  const payload = { title: '任务完成', tone: 'success', heading: '', task: 'x', meta: 'm', error: '' }

  const mac = buildSystemNotification(config, payload, 'darwin')
  assert.equal(mac.command, 'osascript')
  assert.match(mac.args[1], /^display notification "x m" with title "任务完成"$/)

  const win = buildSystemNotification(config, payload, 'win32')
  assert.equal(win.command, 'powershell.exe')
  assert.equal(win.args[0], '-NoProfile')

  assert.equal(buildSystemNotification(config, payload, 'aix'), null)
})

test('a completed turn sends one critical notification', () => {
  const { ctx, emit } = fakeCtx()
  const { calls, spawn } = fakeSpawn()
  apply(ctx, {}, { spawn, isFocused: () => false })

  const session = makeSession('session-a')
  emit('session/event', session, { type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit('session/event', session, {
    type: 'user/message',
    time: 1010,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我写一个通知插件' }] },
  })
  emit('session/event', session, { type: 'step/start', time: 1020, data: { turn: 1, step: 1 } })
  emit('session/event', session, { type: 'step/start', time: 1030, data: { turn: 1, step: 2 } })
  emit('session/event', session, { type: 'turn/end', time: 66_000, data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.command, 'notify-send')
  assert.equal(call.args[call.args.indexOf('-u') + 1], 'critical')
  assert.equal(call.args[call.args.indexOf('-h') + 1], 'string:desktop-entry:deepseek-harness')
  assert.equal(call.args[call.args.length - 2], '任务完成')
  assert.equal(call.args[call.args.length - 1], '帮我写一个通知插件\n用时 1 分 5 秒 · 2 步')
})

test('a focused DeepSeek Harness window suppresses the notification', () => {
  const { ctx, emit } = fakeCtx()
  const { calls, spawn } = fakeSpawn()
  apply(ctx, {}, { spawn, isFocused: () => true })

  const session = makeSession('session-a')
  emit('session/event', session, { type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit('session/event', session, { type: 'turn/end', time: 2000, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(calls.length, 0)
})

test('skipWhenFocused: false still notifies while focused', () => {
  const { ctx, emit } = fakeCtx()
  const { calls, spawn } = fakeSpawn()
  apply(ctx, { skipWhenFocused: false }, { spawn, isFocused: () => true })

  const session = makeSession('session-b')
  emit('session/event', session, { type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit('session/event', session, { type: 'turn/end', time: 2000, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(calls.length, 1)
})

test('subagent sessions stay silent by default', () => {
  const { ctx, emit } = fakeCtx()
  const { calls, spawn } = fakeSpawn()
  apply(ctx, {}, { spawn, isFocused: () => false })

  const session = makeSession('session-sub', { origin: 'subagent' })
  emit('session/event', session, { type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit('session/event', session, { type: 'turn/end', time: 2000, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(calls.length, 0)
})

test('background jobs produce a follow-up notification', () => {
  const { ctx, emit } = fakeCtx()
  const { calls, spawn } = fakeSpawn()
  apply(ctx, {}, { spawn, isFocused: () => false })

  const session = makeSession('session-jobs')
  emit('session/event', session, { type: 'turn/start', time: 1000, data: { turn: 1 } })
  emit('session/event', session, { type: 'job/registered', time: 1100, data: { jobId: 'job-1' } })
  emit('session/event', session, { type: 'turn/end', time: 2000, data: { turn: 1, reason: { kind: 'completed' } } })

  assert.equal(calls.length, 1)
  assert.match(calls[0].args[calls[0].args.length - 1], /另有 1 个后台任务运行中/)

  emit('session/event', session, { type: 'job/settled', time: 9000, data: { jobId: 'job-1', status: 'failed' } })
  assert.equal(calls.length, 2)
  const followUp = calls[1].args
  assert.equal(followUp[followUp.length - 2], '后台任务结束（有失败）')
  assert.match(followUp[followUp.length - 1], /1 个后台任务已全部结束（1 个失败）/)
  assert.equal(followUp[followUp.indexOf('-u') + 1], 'critical')
})

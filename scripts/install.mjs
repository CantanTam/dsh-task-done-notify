import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const PROFILE = '/home/one/.dsh/profiles/desktop'
const PACKAGE = '/home/one/桌面/dsh_notify/dsh-task-done-notify'
const NAME = 'dsh-task-done-notify'
const SPEC = 'link:../../../桌面/dsh_notify/dsh-task-done-notify'
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function guard(target) {
  const full = resolve(target)
  if (!full.startsWith(PROFILE + '/')) throw new Error('refusing to modify ' + full)
  return full
}

const pkgPath = guard(join(PROFILE, 'package.json'))
const patchPath = guard(join(PROFILE, 'cordis.patch.yml'))
const linkPath = guard(join(PROFILE, 'node_modules', NAME))
const backupDir = join('/home/one/.dsh', 'backup-dsh-notify-' + stamp)
mkdirSync(backupDir, { recursive: true })
copyFileSync(pkgPath, join(backupDir, 'package.json'))
copyFileSync(patchPath, join(backupDir, 'cordis.patch.yml'))

mkdirSync(join(PROFILE, 'node_modules'), { recursive: true })
let linkState = 'created'
try {
  const stat = lstatSync(linkPath)
  if (!stat.isSymbolicLink()) throw new Error('refusing to replace non-symlink ' + linkPath)
  const current = resolve(PROFILE, readlinkSync(linkPath))
  if (current !== resolve(PACKAGE)) {
    unlinkSync(linkPath)
    symlinkSync(PACKAGE, linkPath)
    linkState = 'relinked'
  } else {
    linkState = 'unchanged'
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  symlinkSync(PACKAGE, linkPath)
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.dependencies ??= {}
const changes = []
if (pkg.dependencies[NAME] !== SPEC) {
  pkg.dependencies[NAME] = SPEC
  changes.push('dependency')
}
pkg.dsh ??= {}
pkg.dsh.profile ??= {}
pkg.dsh.profile.bundles ??= []
if (!pkg.dsh.profile.bundles.includes(NAME)) {
  pkg.dsh.profile.bundles.push(NAME)
  changes.push('bundle')
}
if (changes.length > 0) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

let patch = readFileSync(patchPath, 'utf8')
let patchChanged = false
if (!patch.includes('id: ui-task-notification')) {
  patch = patch.trimEnd() + '\n\n' +
    '# 旧的 node-notifier 通知插件会被新的常驻通知取代（通知几秒后自动消失）。\n' +
    '# 想恢复旧插件：把 disabled 改成 false，或删掉这三行。\n' +
    '- id: ui-task-notification\n' +
    '  name: dsh-plugin-task-notification\n' +
    '  disabled: true\n'
  writeFileSync(patchPath, patch)
  patchChanged = true
}

console.log(JSON.stringify({ backupDir, linkState, packageJson: changes.length > 0 ? changes : 'unchanged', patch: patchChanged ? 'disabled-old-plugin' : 'unchanged' }, null, 2))

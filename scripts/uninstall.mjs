import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const PROFILE = '/home/one/.dsh/profiles/desktop'
const PACKAGE = '/home/one/桌面/dsh_notify/dsh-task-done-notify'
const NAME = 'dsh-task-done-notify'
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function guard(target) {
  const full = resolve(target)
  if (!full.startsWith(PROFILE + '/')) throw new Error('refusing to modify ' + full)
  return full
}

const pkgPath = guard(join(PROFILE, 'package.json'))
const patchPath = guard(join(PROFILE, 'cordis.patch.yml'))
const linkPath = guard(join(PROFILE, 'node_modules', NAME))
const backupDir = join('/home/one/.dsh', 'backup-dsh-notify-uninstall-' + stamp)
mkdirSync(backupDir, { recursive: true })
copyFileSync(pkgPath, join(backupDir, 'package.json'))
copyFileSync(patchPath, join(backupDir, 'cordis.patch.yml'))

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
delete pkg.dependencies?.[NAME]
const bundles = pkg.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  const index = bundles.indexOf(NAME)
  if (index >= 0) bundles.splice(index, 1)
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

let removedLink = false
if (existsSync(linkPath)) {
  const stat = lstatSync(linkPath)
  if (stat.isSymbolicLink() && resolve(PROFILE, readlinkSync(linkPath)) === resolve(PACKAGE)) {
    unlinkSync(linkPath)
    removedLink = true
  } else {
    console.warn('left ' + linkPath + ' alone: it is not a symlink to ' + PACKAGE)
  }
}

const DISABLED_BLOCK_START = '# 旧的 node-notifier 通知插件会被新的常驻通知取代（通知几秒后自动消失）。'
let patch = readFileSync(patchPath, 'utf8')
let restoredOldPlugin = false
const start = patch.indexOf(DISABLED_BLOCK_START)
if (start >= 0) {
  const blockEnd = patch.indexOf('disabled: true', start)
  if (blockEnd >= 0) {
    const cutTo = patch.indexOf('\n', blockEnd)
    patch = (patch.slice(0, start) + patch.slice(cutTo + 1)).replace(/\n{3,}/g, '\n\n')
    writeFileSync(patchPath, patch.endsWith('\n') ? patch : patch + '\n')
    restoredOldPlugin = true
  }
}

console.log(JSON.stringify({ backupDir, removedLink, dependencyRemoved: true, bundleRemoved: !bundles?.includes(NAME), oldPluginReenabled: restoredOldPlugin }, null, 2))

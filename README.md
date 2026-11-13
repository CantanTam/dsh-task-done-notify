# dsh_notify — DSH 任务完成通知（橙色竖线，全局）

任务跑完（成功 / 出错 / 中止）时，在桌面右下角弹一条**系统通知**：
固定 critical 紧急度，也就是 KDE 下带**橙色竖线**、不会自动消失、点 × 才关的样式。
**如果 DeepSeek Harness 窗口处于聚焦状态则不弹**（`skipWhenFocused: true`），
你在别处做事时才会收到提醒。

- 插件本体：[dsh-task-done-notify/](./dsh-task-done-notify/)
- 中文说明：[dsh-task-done-notify/README.zh-CN.md](./dsh-task-done-notify/README.zh-CN.md)
- 测试：`cd dsh-task-done-notify && node --test`

## 现在的实现

- 只有宿主一半（index.js），监听 `session/event` 的 `turn/end`；
- Linux：`notify-send -a 'DeepSeek Harness' -u critical -t 0 \
  -i deepseek-harness -h string:desktop-entry:deepseek-harness …`
  - `-u critical` = 橙色竖线 + 常驻；
  - `desktop-entry` 让 Plasma 按 DeepSeek Harness 的通知策略放行弹窗
    （否则会落进 `[Applications][@other]`，很容易被静音）；
- macOS `osascript` / Windows PowerShell toast 保留为 best effort；
- 覆盖所有会话、所有工作区；子代理默认不弹；后台任务没结束时先提示、结束后补一条；
- **DSH 窗口内右下角的卡片已删除**，不再有页面内通知。

## 样式

你喜欢的橙色竖线就是 critical 紧急度的原生样式。插件固定使用它，没有开关。
（普通紧急度是灰色、没有竖线，已不再使用。）

## 本机安装状态

已经装进当前 `desktop` profile：

- `~/.dsh/profiles/desktop/package.json`
  - 依赖：`"dsh-task-done-notify": "link:../../../桌面/dsh_notify/dsh-task-done-notify"`
  - `dsh.profile.bundles` 末尾：`dsh-task-done-notify`
- `~/.dsh/profiles/desktop/node_modules/dsh-task-done-notify` → 软链到本目录
- `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾：旧插件 `ui-task-notification`
  设为 `disabled: true`
- 改动前备份：`~/.dsh/backup-dsh-notify-*`

**改完代码后请完全退出 DeepSeek Harness 再打开一次**：宿主进程里可能残留旧模块，
页面里的旧客户端插件也需要重启后才会消失。

## 结构

    dsh_notify/
    ├── dsh-task-done-notify/
    │   ├── index.js            宿主：turn/end → 系统通知（critical + desktop-entry）
    │   ├── cordis.patch.yml    bundle 层：插入 desktop-notify 行和默认配置
    │   ├── package.json        dsh.bundle.patch
    │   ├── test/notify.test.js 11 个测试
    │   └── README*.md
    ├── scripts/
    │   ├── install.mjs
    │   └── uninstall.mjs
    └── README.md

## 配置

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加：

    - id: desktop-notify
      name: dsh-task-done-notify
      config:
        notifySubagents: true

完整字段见插件 README。

## 卸载

    node /home/one/桌面/dsh_notify/scripts/uninstall.mjs

## License

GPL-3.0-or-later. See [LICENSE](../LICENSE).

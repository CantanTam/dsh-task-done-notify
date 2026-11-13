# dsh-task-done-notify

任务跑完（成功 / 出错 / 中止）时，在桌面右下角弹一条**系统通知**：

- 固定使用 **critical 紧急度**，也就是 KDE 下带**橙色竖线**、不会自动消失、
  点 × 才关的那个样式；
- 全局显示，不在 DSH 窗口里也能看到；
- **如果 DeepSeek Harness 窗口正处于聚焦状态，就不弹**——你在跑任务期间去做
  别的事情，任务完成时才提醒你；你盯着 DSH 时不会打扰；
- 没有页面内卡片（已删除），只有系统通知。

## 聚焦判断是怎么做的

在 X11 下用 `xdotool` / `xprop` 读当前活动窗口，满足任一条件就认为「DSH 聚焦」：

1. 活动窗口标题包含 `DeepSeek Harness`（桌面端窗口，或浏览器里打开 DSH 的标签页）；
2. 活动窗口 `WM_CLASS` 是 `deepseek-harness`；
3. 活动窗口 `_NET_WM_PID` 是本插件进程的祖先进程（即 DSH 桌面端主进程）。

判断失败（Wayland、没装 xdotool、读不到窗口）时**照常弹通知**，不会误吞。
想关掉这个行为：配置里加 `skipWhenFocused: false`。

## 组成

只有宿主一半（index.js），没有浏览器端：

- 监听 `session/event` 的 `turn/end`，提取会话标题、提示词摘要、用时、步数、
  错误摘要；
- 调系统通知：
  - Linux：`notify-send` + `-h string:desktop-entry:deepseek-harness`，
    `-u critical`、`-t 0`、图标 `deepseek-harness`；
  - macOS：`osascript -e 'display notification …'`（best effort）；
  - Windows：PowerShell `Windows.UI.Notifications` toast（best effort）。
- 覆盖所有会话（所有工作区）；成功/失败/中止都弹；子代理默认不弹。
- 这一轮还有后台任务没结束时，先提示「另有 N 个后台任务运行中」，
  全部结束后补一条「后台任务已结束」，失败会标出来。

## 为什么之前系统通知看不到（已修好）

本机 Plasma 的 `~/.config/plasmanotifyrc` 里有：

    [Applications][@other]
    ShowPopups=false

「其他应用」的弹窗被关了。`notify-send` 没有应用身份就会落进 `@other`，
于是通知进了历史但不弹窗。带上 `desktop-entry:deepseek-harness` 后，
Plasma 按已注册的 DeepSeek Harness 策略显示，实测右下角正常弹出。

## 安装 / 生效

已经装进当前 `desktop` profile。**改完代码后请完全退出 DeepSeek Harness
再打开一次**（桌面端的客户端插件清单只在启动时加载，且旧进程里可能残留旧模块）。

## 配置

在 profile 的 `cordis.patch.yml` 末尾覆盖：

    - id: desktop-notify
      name: dsh-task-done-notify
      config:
        notifySubagents: true

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| enabled | true | 总开关 |
| skipWhenFocused | true | DSH 窗口聚焦时不弹通知 |
| notifySubagents | false | 子代理会话结束是否也弹 |
| notifyJobsSettled | true | 后台任务全部结束时补一条 |
| appName | DeepSeek Harness | 通知头部显示的应用名 |
| desktopEntry | deepseek-harness | Linux 的 `desktop-entry` 提示，决定用哪个应用的通知策略 |
| icon | deepseek-harness | Linux 通知图标（主题图标名或图片路径） |
| systemExpireMs | 0 | 超时毫秒；0 = 不自动消失 |
| taskMaxChars | 60 | 提示词摘要最多字符数 |

紧急度固定是 `critical`（橙色竖线样式），没有开关。

## 排错

- 没弹：
  1. 确认 `~/.config/plasmanotifyrc` 里 `[Applications][deepseek-harness]`
     的 `ShowPopups` 不是 `false`；
  2. 手动验证同一条命令：

        notify-send -a 'DeepSeek Harness' -h string:desktop-entry:deepseek-harness \
          -u critical -t 0 -i deepseek-harness '测试' '能看到橙色竖线吗'

- 想看宿主日志：运行环境里的 `ctx.logger('desktop-notify')` 警告。

## 卸载

    node /home/one/桌面/dsh_notify/scripts/uninstall.mjs

## 开发

    cd /home/one/桌面/dsh_notify/dsh-task-done-notify
    node --test

13 个测试：纯函数、三平台通知 argv（Linux 固定 critical + desktop-entry）、
turn 结束发一条、聚焦时跳过、子代理过滤、后台任务补发。

## License

GPL-3.0-or-later. See [LICENSE](../LICENSE).

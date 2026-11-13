# dsh-task-done-notify

One OS-level desktop notification per finished turn (success, error or abort).

- Always critical urgency on Linux: KDE renders it with the **orange stripe**
  and keeps it until dismissed.
- Global — it does not need the DSH window.
- **Skipped while the DeepSeek Harness window is focused** (config:
  `skipWhenFocused`, default true). The check reads the active X11 window
  (title / WM_CLASS / owning process); it fails open, so Wayland or a missing
  `xdotool` still notifies.
- The old in-page bottom-right card has been removed; this plugin is host-only.

See [README.zh-CN.md](./README.zh-CN.md) for the full documentation.

## How it works

`index.js` listens to `session/event`, builds the notice on `turn/end` and calls
the platform notifier:

| Platform | Command |
| --- | --- |
| Linux | `notify-send -u critical -t 0 -h string:desktop-entry:deepseek-harness …` |
| macOS | `osascript -e 'display notification …'` |
| Windows | PowerShell `Windows.UI.Notifications` toast |

The desktop-entry hint is what makes Plasma apply the DeepSeek Harness policy;
without it notifications fall into `[Applications][@other]`, which may have
`ShowPopups=false`.

## Config (defaults)

    - id: desktop-notify
      name: dsh-task-done-notify
      config:
        skipWhenFocused: true
        notifySubagents: false
        notifyJobsSettled: true
        taskMaxChars: 60
        desktopEntry: deepseek-harness
        icon: deepseek-harness
        systemExpireMs: 0

## Restart after code changes

The desktop shell only loads the client-plugin graph at startup, and the host
process can keep an older module instance alive; fully quit and reopen DeepSeek
Harness after changing this plugin.

## Test

    node --test

## License

GPL-3.0-or-later. See [LICENSE](../LICENSE).

// System notifications, pure: the commands that raise one on each OS, tried in
// order until one runs. The text goes in as an argument or the environment,
// never through a shell, so nothing in it is ever run.

export type Notifier = { argv: string[]; env?: Record<string, string> }

// A toast under PowerShell's own app id: Windows shows none for an unregistered one.
const TOAST = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  '$x = $t.GetElementsByTagName("text")',
  '$x.Item(0).AppendChild($t.CreateTextNode($env:PAIRPLAY_TITLE)) > $null',
  '$x.Item(1).AppendChild($t.CreateTextNode($env:PAIRPLAY_TEXT)) > $null',
  '$app = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"',
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($t))',
].join('; ')

/** The notifiers to try, in order: a toast on Windows; notify-send (Linux, BSD), then osascript (macOS). */
export function notifiers(title: string, text: string, windows: boolean): Notifier[] {
  if (windows) {
    return [{ argv: ['powershell', '-NoProfile', '-NonInteractive', '-Command', TOAST], env: { PAIRPLAY_TITLE: title, PAIRPLAY_TEXT: text } }]
  }
  return [
    { argv: ['notify-send', '-a', 'pairplay', title, text] },
    { argv: ['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, text] },
  ]
}

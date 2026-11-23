/**
 * The items on the bar's right side, in their order there. The settings panel
 * in the island lets each be hidden; the bar reads the hidden list from the
 * widgets' shared storage (`STORED.barHidden`). The list holds hidden items,
 * so an item added in a later version shows up by default.
 */
export const BAR_ITEMS = [
  { id: 'media', label: 'Now playing', hint: 'The playing track, while music or video plays' },
  { id: 'timer', label: 'Timers', hint: 'A running timer, pomodoro or stopwatch' },
  { id: 'todo', label: 'Open tasks', hint: 'How many to-do items are left' },
  { id: 'notify', label: 'Notifications', hint: 'A bell with the number of notifications' },
  { id: 'mic', label: 'Muted microphone', hint: 'A red microphone while it is muted' },
  { id: 'awake', label: 'Keep awake', hint: 'A cup while the computer is kept awake' },
  { id: 'speed', label: 'Network speed', hint: 'Download and upload speed' },
  { id: 'network', label: 'Wi-Fi', hint: 'Connection and signal strength' },
  { id: 'bluetooth', label: 'Bluetooth', hint: 'Radio and connected devices' },
  { id: 'battery', label: 'Battery', hint: 'Charge level' },
] as const;

export type BarItemId = (typeof BAR_ITEMS)[number]['id'];

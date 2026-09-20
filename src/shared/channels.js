// IPC channel names, shared by the main process and the preloads.
//
// These were previously declared as constants in src/main/notifications.js and
// then written again as string literals in src/preload/account.js. A rename in
// one place broke the bridge silently, with no error anywhere -- the message
// was simply sent on a channel nobody listened to.
//
// The two unread channels are deliberately distinct names. They carry the same
// payload shape but they are different contracts travelling in opposite
// directions: the page reports a count inward, and the main process publishes
// a count outward to the sidebar.

module.exports = {
  // page -> main
  NOTIFY: 'symmetria:notify',
  UNREAD_REPORTED: 'symmetria:unread',
  NOTIFICATION_CLOSED_BY_PAGE: 'symmetria:notification-close',
  ACCOUNT_AVATAR: 'symmetria:account-avatar',

  // main -> page
  NOTIFICATION_CLICKED: 'symmetria:notification-click',

  // main -> shell renderer
  UNREAD_CHANGED: 'symmetria:unread-changed',
  ACCOUNT_AVATAR_CHANGED: 'symmetria:account-avatar-changed',
  ACTIVE_ACCOUNT: 'symmetria:active-account',
  DOWNLOAD: 'symmetria:download',

  // shell renderer -> main
  SHELL_STATE: 'symmetria:shell-state',
  SELECT_ACCOUNT: 'symmetria:select-account',
}

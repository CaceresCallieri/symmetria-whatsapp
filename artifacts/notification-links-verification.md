# Notification link fix

The screenshot shows Symmetria Shell notifications. The WhatsApp wrapper sends
the message body without link styling. Symmetria Shell uses Qt MarkdownText,
which renders links with the default blue foreground and ignores Text.linkColor.

Source checkout: /home/dev/symetria-shell-notification-links

Patch baseline: CaceresCallieri/symetria-shell commit
77cdfafdb2e56394dd16517b6ffd67baf62103de.

The patch adds one shared NotificationBodyText component for the popup preview,
expanded popup, and expanded notification history. CUtils parses Markdown with
QTextDocument, sets the anchor foreground to the theme primary colour, and exports
HTML. Qt renders the HTML with the existing notification font. Link targets and
the notification activation handlers remain intact.

## Verification

- Compiled the changed CUtils source and its generated moc source against Qt 6.11.2.
- Checked two link targets, query parameters, Markdown bold text, literal text,
  the anchor foreground, and an empty body.
- Loaded the actual NotificationBodyText and StyledText components in a Qt QML
  renderer. Only the theme and appearance services used probe values.
  The harness compiled CUtils and its moc source, then registered CUtils as a
  QML singleton with qmlRegisterSingletonType. It did not build the complete plugin.
- Passed nine assertions for the baseline colour, three themed bodies, three
  link targets, and unchanged width and height for the screenshot URL.
- Captured and inspected notification-links-before-after.png. The baseline is
  blue. The fixed bodies use the theme primary colour, #bdc2c7.
- Passed QML formatting checks for all three changed QML files.
- QML lint exited zero. Quickshell and the complete Symmetria plugin are absent
  here, so lint reported unresolved imports. The standalone Qt renderer loaded
  the changed native method and shared body component successfully.
- Passed all 23 shell tests and all 73 WhatsApp tests.
- Passed all eight WhatsApp notification checks through Electron and D-Bus.
- Checked that the patch applies to an unmodified copy of the baseline.
- Stopped the Electron verification service after the checks.

## Installation status

The fix is prepared in the source checkout and in
symmetria-shell-notification-links.patch. It is not installed on the laptop.
SSH to arch-laptop returned Permission denied (publickey).

The patch changes the Symmetria native plugin. Build and install that plugin
together with the QML changes. Copying only the QML files leaves the new CUtils
method unavailable. This server lacks cmake and the full plugin dependencies
libqalculate, aubio, and libcava, so the complete plugin build did not run here.

The shell instructions prohibit starting or restarting the live shell. The
operator must restart it after the plugin and QML changes are installed.

Apply the patch from the root of the Symmetria Shell checkout:

```bash
git apply /absolute/path/to/symmetria-shell-notification-links.patch
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/ -DINSTALL_QSCONFDIR="$HOME/.config/quickshell/symmetria"
cmake --build build
sudo cmake --install build
sudo chown -R "$USER:$USER" "$HOME/.config/quickshell/symmetria"
rm -rf "$HOME/.cache/quickshell/qmlcache"
```

Use the operator's normal shell restart procedure after installation. Automated
commands must not start or restart the live shell.

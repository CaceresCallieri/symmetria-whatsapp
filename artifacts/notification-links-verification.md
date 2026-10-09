# Notification link fix

The screenshot shows Symmetria Shell notifications. The WhatsApp wrapper sends
the message body without link styling. Symmetria Shell uses Qt MarkdownText,
which renders links with the default blue foreground and ignores Text.linkColor.

Source checkout: /home/dev/symetria-shell-notification-links

Patch baseline: CaceresCallieri/symetria-shell commit
77cdfafdb2e56394dd16517b6ffd67baf62103de.

Canonical source: PR #70: fix(notifications): use readable theme colours for links.
https://github.com/CaceresCallieri/symetria-shell/pull/70
The patch is a snapshot through commit 1720ddd. Future fixes belong in the shell
repository rather than in this snapshot.

The collapsed popup preview uses plain text with direct elision. The patch adds
one shared NotificationBodyText component for the expanded popup and expanded
notification history. CUtils parses Markdown with QTextDocument, sets the anchor
foreground to the theme primary colour, and exports HTML. Qt renders the HTML
with the existing notification font. Link targets and the notification activation
handlers remain intact.

## Verification

- Compiled the changed CUtils source and its generated moc source against Qt 6.11.2.
- Checked two link targets, query parameters, Markdown bold text, literal text,
  the anchor foreground, and an empty body.
- Loaded the actual NotificationBodyText and StyledText components in a Qt QML
  renderer. Only the theme and appearance services used probe values.
  The harness compiled CUtils and its moc source, then registered CUtils as a
  QML singleton with qmlRegisterSingletonType. It did not build the complete plugin.
- Passed nine assertions for the baseline colour, a plain preview, two themed
  bodies, two link targets, a non-clickable preview, and unchanged width and
  height for the screenshot URL.
- Captured and inspected notification-links-before-after.png. The baseline is
  blue. The expanded bodies use the theme primary colour, #bdc2c7. The preview
  uses the normal body colour, #bec2c6.
- Passed QML formatting checks for all three changed QML files.
- QML lint exited zero. Quickshell and the complete Symmetria plugin are absent
  here, so lint reported unresolved imports. The standalone Qt renderer loaded
  the changed native method and shared body component successfully.
- Passed all 24 shell tests and all 73 WhatsApp tests. The new shell test compiles
  the actual CUtils implementation and checks adjacent and formatted anchors,
  two theme colours, Unicode, non-link formatting, backgrounds, and empty bodies.
- Passed all eight WhatsApp notification checks through Electron and D-Bus.
- Checked that the patch applies to an unmodified copy of the baseline.
- Counted 761 theme pixels and zero blue pixels in the after region of the image.
  The image background is #171819.
- Passed the declared Python checks: ruff and pyrefly 1.2.0.
- GitHub's first type check found that its isolated environment lacks pytest.
  The wrapper now uses standard-library unittest. The isolated uvx type check
  and direct unittest execution passed without pytest imports.
- The source review fixed fragment iteration safety, preview elision, theme-update
  animations, and default HTML underlines. The source records the necessary
  RichText workaround and its removal condition.
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

After the source PR merges, update the Symmetria Shell checkout and rebuild:

```bash
git switch main
git pull --ff-only
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/ -DINSTALL_QSCONFDIR="$HOME/.config/quickshell/symmetria"
cmake --build build
sudo cmake --install build
sudo chown -R "$USER:$USER" "$HOME/.config/quickshell/symmetria"
rm -rf "$HOME/.cache/quickshell/qmlcache"
```

Use the operator's normal shell restart procedure after installation. Automated
commands must not start or restart the live shell.

To reproduce the patch on an unmodified copy of the baseline instead, run
`git apply /absolute/path/to/symmetria-shell-notification-links.patch` before the
build commands. Do not apply the snapshot to a checkout that already contains
the merged source fix.

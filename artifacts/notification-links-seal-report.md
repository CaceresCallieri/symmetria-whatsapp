# Seal report: notification links

The seal pipeline reviewed two repositories in Uncommitted-Work mode. The
orchestrator created the progress commits, triaged the findings, and created
separate fixes commits. The reviewers used the installed code-reviewer agent
definition and did not modify files.

## WhatsApp workspace

Repository: /home/dev/.mesura-code/worktrees/symmetria-whatsapp/t3code-a3e81313

- Progress: af26577 — docs(notifications): record the verified shell link fix.
- Effort: medium. The changes contain evidence and a source patch snapshot.
- Reviewer: code-reviewer on Sonnet.
- Fixes: 6ee4843 — fix(notifications): clarify the verification and install procedure.
- The final artifact refresh includes the source review fixes and this report.
- Seven findings: two documentation fixes, one native test assigned to the shell
  repository, and four skipped findings.
- Tests: all 73 WhatsApp tests passed. The earlier Electron/D-Bus verification
  passed all eight notification checks.
- Remaining uncommitted files after the artifact refresh: zero.

| # | Location | Finding | Outcome |
|---|---|---|---|
| A1 | Verification report | Rename the repository and checkout to symmetria-shell | Skipped. The actual repository slug and directory are symetria-shell. |
| A2 | Native HTML export | Possible white background or unsupported export | Skipped as a bug claim. Native background assertions and rendered pixels confirm the expected dark background. |
| A3 | Native converter | No permanent regression coverage | Fixed in the shell repository with a compiled behavioural test. |
| A4 | Verification report | Standalone harness coverage is unclear | Fixed. The report names compilation, moc generation, and qmlRegisterSingletonType. |
| A5 | CUtils | Move the converter to a new service | Skipped. CUtils already provides native presentation helpers. A new module adds registration overhead for one method. |
| A6 | Installation record | No concrete build/install steps | Fixed. The report distinguishes updating merged source from applying the baseline snapshot. |
| A7 | Converter binding | Add a cache if conversion becomes expensive | Skipped. No measured cache need. The source fix removes preview conversion. |

## Symmetria Shell

Repository: /home/dev/symetria-shell-notification-links

- Progress: 03d73bd — fix(notifications): render links with the shell theme colour.
- Effort: high. The change connects a new component to a native method and two
  existing notification views.
- Reviewer: code-reviewer on Opus.
- Fixes: 76f372a — fix(notifications): preserve formatting and bound the preview.
- CI repair: 1720ddd — fix(tests): run the notification regression without pytest imports.
- Eleven findings: nine fixed or covered by another fix, and two skipped.
- An additional behavioural test found default HTML anchor underlines. The fixes
  commit preserves the original underline policy.
- All executable commands in the declared change gate exited zero after fixes.
- All 24 shell tests passed. The new test compiled and ran; it did not skip.
- The Qt QML renderer passed nine assertions. The after region contains 761
  theme pixels and zero pure-blue pixels on a #171819 background.
- Remaining uncommitted files: zero.

| # | Location | Finding | Outcome |
|---|---|---|---|
| S1 | Expanded body animation | Theme/font changes replay the message animation | Fixed. Exported HTML updates do not trigger the body text animation. |
| S2 | Native fragment loop | Formatting can invalidate a live fragment iterator | Fixed. Collect anchor cursors before changing formats. |
| S3 | NotificationBodyText | RichText exception is undocumented | Fixed. A WORKAROUND comment names the constraint and removal condition. |
| S4 | Native converter | Font parameter rationale is missing | Fixed. The source explains that HTML export embeds the default font. |
| S5 | Empty body | Empty-string contract is implicit | Fixed. The source records why an empty document must return an empty string. |
| S6 | Collapsed preview | Elision measures Markdown syntax and can break links | Fixed. Plain text uses native elision directly. |
| S7 | Preview conversion | Every popup converts two Markdown documents | Covered by S6. The preview no longer calls the converter. No cache was added. |
| S8 | Existing link handlers | Restrict schemes and remote resources | Skipped. Existing notification behaviour accepts general links. This change does not introduce that behaviour. |
| S9 | Existing link handlers | Extract the launch command | Skipped. The unchanged one-line handlers differ in their activation and closing behaviour. |
| S10 | Regression coverage | Add source-text assertions for the rendering implementation | Fixed with behavioural native tests instead of assertions that mirror source text. The actual shared QML component also passed the standalone rendering check. |
| S11 | Qt pitfall | The failed linkColor-only fix is not recorded | Fixed in docs/qml-pitfalls.md. |

The RichText workaround remains necessary. Qt's Markdown importer fixes the
anchor foreground before Text.linkColor applies. The shared component renders
Qt-exported HTML to preserve formatting and the themed foreground. The source
marks the workaround for removal when Qt supports themed Markdown links.

## Retained deterministic findings

The project demotes these QML categories to info. They do not block its change
gate. The native plugin and Quickshell imports are unavailable on this server.
Existing unrelated diagnostics remain outside this review's source changes.

| Rule emitted by qmllint | Count | Locations | Reason retained |
|---|---|---|---|
| import | 21 | Shared component and notification views | Quickshell/native modules and their dependent composite types are unavailable. |
| unqualified | 9 | Shared component and notification views | Missing native types or existing parent/Quickshell references. |
| unresolved-type | 4 | Existing icon and clipping items in Notification.qml | Missing Quickshell types. |
| missing-property | 4 | Existing notification layout, palette, and loader references | Existing diagnostics outside the changed logic. |
| redundant-optional-chaining | 1 | Existing action handling in Notification.qml | Existing diagnostic outside the changed logic. |

The source reviewer could not execute its Bash diff command under the read-only
tool policy. It reviewed the current target files. The orchestrator inspected
the exact progress diff and verified the proposed fixes against the baseline.

## Rollup

| Repository | Progress | Effort | Findings | Fixed or covered | Skipped | Fixes | Remaining files |
|---|---|---|---|---|---|---|---|
| WhatsApp workspace | af26577 | medium | 7 | 3, including the test assigned to Shell | 4 | 6ee4843 and artifact refresh | 0 |
| Symmetria Shell | 03d73bd | high | 11 | 9 | 2 | 76f372a and 1720ddd | 0 |

The test finding overlaps between the two reviewers. The rollup counts each
reviewer's findings separately. QML advisory findings total 39.

The first GitHub lint run failed because the new test wrapper imported pytest,
which is absent from the isolated type-check environment. That missing import
also prevented type narrowing at the skip guards. Commit 1720ddd uses unittest
and TemporaryDirectory from the standard library. The isolated
`uvx pyrefly@1.2.0 check`, the full 24-test suite, and direct unittest execution
all passed after the repair. The source records why pytest must not be
reintroduced into this wrapper.

The full shell plugin build and live laptop installation did not run. This
server lacks the full build dependencies, and laptop SSH access was denied.
The Electron verification service is stopped.

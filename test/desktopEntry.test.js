// Guards the three strings the desktop entry shares with the application, all
// of which fail silently when they drift.
//
// A wrong `StartupWMClass` costs the launcher its association with the open
// window: the application still starts, and starting it a second time opens a
// second launcher tile instead of raising the window you already have. A wrong
// `Icon` shows a generic placeholder. A wrong `Exec` is the failure this entry
// was written to replace -- the previous one named the binary of the retired
// Qt build, and the launcher reported that the application did not exist.
//
// Only the template is checked. What lands in ~/.local/share/applications is
// written from it by scripts/install-desktop-entry.js, so the template is
// where a mistake enters.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repositoryRoot = path.resolve(__dirname, '..')
const templatePath = path.join(repositoryRoot, 'resources', 'symmetria-whatsapp.desktop')
const template = fs.readFileSync(templatePath, 'utf8')

/** The value of one key, ignoring the comment lines that share its prefix. */
function entryValue(key) {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(template)
  return match ? match[1] : null
}

test('the entry declares the app id Electron will actually use', () => {
  // `app.setName()` is what Electron derives the Wayland app_id from, and the
  // Hyprland window rules for this application match the same string.
  const mainProcess = fs.readFileSync(path.join(repositoryRoot, 'src/main/index.js'), 'utf8')
  const applicationName = /app\.setName\('([^']+)'\)/.exec(mainProcess)?.[1]

  assert.ok(applicationName, 'src/main/index.js no longer calls app.setName()')
  assert.equal(entryValue('StartupWMClass'), applicationName)
})

test('the entry names an icon the repository ships', () => {
  const iconName = entryValue('Icon')
  const installedAs = `${iconName}.png`

  // The installer copies resources/icons/whatsapp-<size>x<size>.png under the
  // icon name, so the name has to be one the theme can hold and the sizes have
  // to exist to copy.
  assert.match(iconName, /^[a-z0-9-]+$/)
  assert.ok(installedAs.endsWith('.png'))

  const sizes = fs
    .readdirSync(path.join(repositoryRoot, 'resources', 'icons'))
    .filter((name) => /^whatsapp-(\d+)x\1\.png$/.test(name))
  assert.ok(sizes.length > 0, 'resources/icons ships no icon the installer can find')
})

test('the entry runs the launcher, not a bare command name', () => {
  // A launcher runs a desktop entry with a PATH that does not include
  // ~/.local/bin. The placeholder is substituted for an absolute path at
  // install time, and a bare command name here would be the old bug returning.
  for (const key of ['Exec', 'TryExec']) {
    assert.equal(entryValue(key), '@LAUNCHER@', `${key} must stay a placeholder`)
  }
})

test('the launcher the installer substitutes in exists and is executable', () => {
  const launcherPath = path.join(repositoryRoot, 'bin', 'symmetria-whatsapp')
  assert.ok(fs.existsSync(launcherPath), `missing: ${launcherPath}`)
  // Committed as mode 755. Without it a desktop entry fails with a permission
  // error and the launcher shows nothing at all.
  assert.ok(fs.statSync(launcherPath).mode & 0o111, 'bin/symmetria-whatsapp is not executable')
})

test('npm start goes through the same launcher the desktop entry does', () => {
  // One definition of how the application starts. The two used to be separate,
  // and the hand-written one is what went stale.
  const packageJson = require(path.join(repositoryRoot, 'package.json'))
  assert.match(packageJson.scripts.start, /bin\/symmetria-whatsapp/)
})

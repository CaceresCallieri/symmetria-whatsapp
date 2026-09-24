#!/usr/bin/env node
// Registers this checkout with the desktop, so the application appears in the
// app launcher and starts from it.
//
// Three things have to agree for that to work, and this script is what makes
// them agree rather than three hand-edited files that drift:
//
//   1. the launcher script      bin/symmetria-whatsapp, symlinked into ~/.local/bin
//   2. the icon                 resources/icons/*, copied into the hicolor theme
//   3. the entry itself         resources/symmetria-whatsapp.desktop, with the
//                               launcher's absolute path substituted in
//
// Re-runnable, and re-running it is the fix after the checkout moves: every
// path it writes is derived from where this file is, so nothing has to be
// edited by hand. Nothing here needs root -- it all lands under $HOME.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const APPLICATION_ID = 'symmetria-whatsapp'

const repositoryRoot = path.resolve(__dirname, '..')
const launcherPath = path.join(repositoryRoot, 'bin', APPLICATION_ID)
const templatePath = path.join(repositoryRoot, 'resources', `${APPLICATION_ID}.desktop`)
const iconsDirectory = path.join(repositoryRoot, 'resources', 'icons')

// The XDG base directories, with the defaults the specification gives when the
// variables are unset -- which they usually are.
const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
const binDirectory = path.join(os.homedir(), '.local', 'bin')
const applicationsDirectory = path.join(dataHome, 'applications')
const iconThemeDirectory = path.join(dataHome, 'icons', 'hicolor')

const steps = []
function record(message) {
  steps.push(message)
  console.log(`  ${message}`)
}

/**
 * Points `linkPath` at `target`, replacing a link that points elsewhere.
 *
 * Refuses to touch a real file. One may be a hand-written launcher from
 * before this script existed, and silently deleting it would take work the
 * user has nowhere else with it.
 */
function installSymlink(linkPath, target) {
  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false })

  if (existing && !existing.isSymbolicLink()) {
    throw new Error(
      `${linkPath} is a real file, not a symlink. Move it aside and re-run; ` +
        'it may be a hand-written launcher worth keeping.'
    )
  }

  if (existing) {
    if (fs.readlinkSync(linkPath) === target) return record(`symlink already correct: ${linkPath}`)
    fs.unlinkSync(linkPath)
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  fs.symlinkSync(target, linkPath)
  record(`symlink: ${linkPath} -> ${target}`)
}

/**
 * Copies every icon size the repository ships into the hicolor theme.
 *
 * The sizes are discovered rather than listed here. A list would be a second
 * place to update when a size is added to resources/icons, and the one that
 * gets forgotten -- the application keeps its icon at the sizes that were
 * listed, so nothing looks wrong.
 */
function installIcons() {
  const iconFiles = fs
    .readdirSync(iconsDirectory)
    .map((name) => ({ name, size: /^whatsapp-(\d+)x\1\.png$/.exec(name)?.[1] }))
    .filter((icon) => icon.size)

  if (iconFiles.length === 0) throw new Error(`No icons found in ${iconsDirectory}`)

  for (const icon of iconFiles) {
    const destinationDirectory = path.join(iconThemeDirectory, `${icon.size}x${icon.size}`, 'apps')
    fs.mkdirSync(destinationDirectory, { recursive: true })
    fs.copyFileSync(
      path.join(iconsDirectory, icon.name),
      path.join(destinationDirectory, `${APPLICATION_ID}.png`)
    )
  }

  record(`icons: ${iconFiles.length} sizes into ${iconThemeDirectory}`)
}

function installDesktopEntry() {
  const entry = fs.readFileSync(templatePath, 'utf8').replaceAll('@LAUNCHER@', launcherPath)

  fs.mkdirSync(applicationsDirectory, { recursive: true })
  const destination = path.join(applicationsDirectory, `${APPLICATION_ID}.desktop`)
  fs.writeFileSync(destination, entry)
  record(`entry: ${destination}`)

  return destination
}

/**
 * Runs a desktop tool that may not be installed, and treats its absence as
 * nothing to report. Every caller is a cache refresh or a validation, so a
 * missing tool costs a nicety rather than the installation.
 */
function runOptional(command, args) {
  try {
    execFileSync(command, args, { stdio: 'pipe' })
    return { ran: true, output: '' }
  } catch (error) {
    if (error.code === 'ENOENT') return { ran: false, output: '' }
    return { ran: true, output: String(error.stderr || error.stdout || error.message).trim() }
  }
}

function main() {
  console.log(`Installing ${APPLICATION_ID} from ${repositoryRoot}`)

  if (!fs.existsSync(launcherPath)) throw new Error(`Missing launcher: ${launcherPath}`)
  // The checkout may have arrived over a transport that drops the mode bit --
  // an archive, a copy, a filesystem mounted without it. Without this the
  // desktop entry fails with a permission error that names the right file and
  // explains nothing.
  fs.chmodSync(launcherPath, 0o755)

  installSymlink(path.join(binDirectory, APPLICATION_ID), launcherPath)
  installIcons()
  const entryPath = installDesktopEntry()

  // Best effort. The launcher reads the directory directly on most desktops,
  // so a stale cache delays the entry appearing rather than preventing it.
  runOptional('update-desktop-database', [applicationsDirectory])
  runOptional('gtk-update-icon-cache', ['--force', '--quiet', iconThemeDirectory])

  const validation = runOptional('desktop-file-validate', [entryPath])
  if (validation.ran && validation.output) {
    console.log('\ndesktop-file-validate reported:')
    console.log(validation.output)
  }

  console.log(`\nDone. ${APPLICATION_ID} is in the app launcher.`)
  console.log(`Start it from a shell with: ${APPLICATION_ID}`)
}

try {
  main()
} catch (error) {
  console.error(`\nInstall failed: ${error.message}`)
  process.exit(1)
}

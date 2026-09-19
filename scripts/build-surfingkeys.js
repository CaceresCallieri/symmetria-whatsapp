#!/usr/bin/env node
// Builds Surfingkeys from source into vendor/surfingkeys.
//
// The build output is not committed -- it is about 6.6 MB of webpack bundles --
// so this script reproduces it. Surfingkeys publishes no package suitable for
// embedding, so building from the tagged source is the supported route.
//
// Usage: npm run build:extension [-- --ref=<git ref>]

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SURFINGKEYS_REPO = 'https://github.com/brookhong/Surfingkeys'

// Pinned so a Surfingkeys release cannot silently change the keyboard layer
// under a user who only reinstalled dependencies. Raise it deliberately, and
// re-run spike/surfingkeys-electron afterwards to confirm the new build still
// attaches to WhatsApp Web.
const DEFAULT_REF = '1.19.2'

const OUTPUT_DIR = path.resolve(__dirname, '../vendor/surfingkeys')

const requestedRef =
  process.argv.find((argument) => argument.startsWith('--ref='))?.split('=')[1] || DEFAULT_REF

function run(command, args, cwd) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function main() {
  const checkoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfingkeys-build-'))

  try {
    console.log(`Building Surfingkeys ${requestedRef}`)
    run('git', ['clone', '--depth', '1', '--branch', requestedRef, SURFINGKEYS_REPO, checkoutDir])
    run('npm', ['install', '--no-audit', '--no-fund'], checkoutDir)
    run('npx', ['webpack', '--mode=production', '--config', './config/webpack.config.js'], checkoutDir)

    const builtChromeDir = path.join(checkoutDir, 'dist/production/chrome')
    if (!fs.existsSync(path.join(builtChromeDir, 'manifest.json'))) {
      throw new Error(`webpack produced no manifest in ${builtChromeDir}`)
    }

    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    fs.cpSync(builtChromeDir, OUTPUT_DIR, { recursive: true })

    // The build drops a packaged copy of itself next to the unpacked files.
    // Electron cannot load a .crx and the archive only wastes disk.
    fs.rmSync(path.join(OUTPUT_DIR, 'sk.zip'), { force: true })

    console.log(`\nSurfingkeys ${requestedRef} installed into ${OUTPUT_DIR}`)
  } finally {
    fs.rmSync(checkoutDir, { recursive: true, force: true })
  }
}

main()

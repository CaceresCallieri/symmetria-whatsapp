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

// Pinned to a commit, because Surfingkeys publishes no tags -- the repository
// has only `master`, `mv3` and `gh-pages`, and the version lives in
// package.json rather than in a ref. A branch name would let a release change
// the keyboard layer under a user who only reinstalled dependencies.
//
// This commit is 1.19.2, and is the build verified against WhatsApp Web. Raise
// it deliberately, and re-run scripts/verify-keyboard-layer.js afterwards.
const DEFAULT_REF = '8d108ed5a9fb34bed383271c2f81e2728ea655f2'
const DEFAULT_REF_VERSION = '1.19.2'

const OUTPUT_DIR = path.resolve(__dirname, '../vendor/surfingkeys')

const requestedRef =
  process.argv.find((argument) => argument.startsWith('--ref='))?.split('=')[1] || DEFAULT_REF

function describeRef(ref) {
  return ref === DEFAULT_REF ? `${DEFAULT_REF_VERSION} (${ref.slice(0, 10)})` : ref
}

function run(command, args, cwd) {
  console.log(`  $ ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function main() {
  const checkoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfingkeys-build-'))

  try {
    console.log(`Building Surfingkeys ${describeRef(requestedRef)}`)

    // A shallow clone cannot take a commit via --branch, which accepts only a
    // branch or tag name. Fetching the commit into an empty repository is the
    // way to get one commit's worth of history for an arbitrary ref, and it
    // still works when the caller passes a branch name instead.
    run('git', ['init', '--quiet', checkoutDir])
    run('git', ['remote', 'add', 'origin', SURFINGKEYS_REPO], checkoutDir)
    run('git', ['fetch', '--depth', '1', '--quiet', 'origin', requestedRef], checkoutDir)
    run('git', ['checkout', '--quiet', 'FETCH_HEAD'], checkoutDir)
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

    console.log(`\nSurfingkeys ${describeRef(requestedRef)} installed into ${OUTPUT_DIR}`)
  } finally {
    fs.rmSync(checkoutDir, { recursive: true, force: true })
  }
}

main()

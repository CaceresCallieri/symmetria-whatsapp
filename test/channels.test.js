// Keeps the preloads' inlined channel names in step with src/shared/channels.js.
//
// The preloads cannot require that module: both run sandboxed, where `require`
// resolves only a small polyfilled set of built-ins. A local require throws
// before contextBridge.exposeInMainWorld runs, which silently removes every
// patch in the file -- no notifications, no unread badge, and in the shell's
// case no sidebar at all. That regression reached a running app once; this
// test is what stops it reaching one again.

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const channels = require('../src/shared/channels')

const PRELOADS = ['src/preload/account.js', 'src/preload/shell.js']
const CHANNEL_PATTERN = /'(symmetria:[a-z-]+)'/g

function readPreload(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

const knownChannelValues = new Set(Object.values(channels))

for (const relativePath of PRELOADS) {
  test(`${relativePath} uses no channel name that channels.js does not define`, () => {
    const source = readPreload(relativePath)
    const used = new Set(Array.from(source.matchAll(CHANNEL_PATTERN), (match) => match[1]))
    assert.notEqual(used.size, 0, 'expected the preload to declare some channel names')

    for (const channel of used) {
      assert.ok(
        knownChannelValues.has(channel),
        `${relativePath} uses '${channel}', which is not in src/shared/channels.js`
      )
    }
  })

  test(`${relativePath} does not require a local module (it runs sandboxed)`, () => {
    const source = readPreload(relativePath)
    const localRequires = Array.from(source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g))
    assert.deepEqual(
      localRequires.map((match) => match[1]),
      [],
      'a sandboxed preload cannot resolve a local require; inline the value instead'
    )
  })
}

test('channels.js defines no duplicate channel strings', () => {
  const values = Object.values(channels)
  assert.equal(new Set(values).size, values.length, 'two keys share one channel string')
})

// 微信 showModal 的按钮文字最多 4 个汉字，超了真机上弹窗直接失败、点了没反应
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : sources(p)
    return /\.ts$/.test(d.name) ? [p] : []
  })
}

const width = s => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)

test('every modal button label fits in 4 Chinese characters', () => {
  const root = path.join(__dirname, '..')
  const offenders = []
  for (const file of [...sources(path.join(root, 'pages')), path.join(root, 'app.ts')].filter(fs.existsSync)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/(confirmText|cancelText):\s*(['`])([^'`]*)\2/g)) {
      if (width(m[3]) > 8) offenders.push(`${path.relative(root, file)}: ${m[1]} '${m[3]}'`)
    }
  }
  assert.deepEqual(offenders, [])
})

// Tiny zero-dependency static server used to preview the built renderer in a
// normal browser (the app auto-switches to demo data when not inside Electron).
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', 'out', 'renderer')
const port = Number(process.env.PORT || 4173)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath === '/') urlPath = '/index.html'
    const filePath = path.join(root, urlPath)
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback
        fs.readFile(path.join(root, 'index.html'), (e2, html) => {
          if (e2) {
            res.writeHead(404).end('Not found')
          } else {
            res.writeHead(200, { 'Content-Type': types['.html'] }).end(html)
          }
        })
        return
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' }).end(data)
    })
  })
  .listen(port, () => {
    console.log(`Preview server running at http://localhost:${port} (serving ${root})`)
  })

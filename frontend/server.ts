import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import os from 'os'

const dev = process.env.NODE_ENV !== 'production'
// Use '0.0.0.0' to allow access from other devices on the same network
// Set HOSTNAME=localhost in .env if you want to restrict to localhost only
const hostname = process.env.HOSTNAME || '0.0.0.0'
const port = parseInt(process.env.PORT || '4002', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  // Increase timeouts for long-running proxied requests (e.g. IMAP email fetch)
  server.keepAliveTimeout = 120000 // 2 minutes
  server.headersTimeout = 125000   // Must exceed keepAliveTimeout
  server.requestTimeout = 300000   // 5 minutes max for any request
  server.timeout = 300000          // 5 minutes socket timeout

  server.listen(port, hostname, () => {
    const displayHostname = hostname === '0.0.0.0' ? 'localhost' : hostname
    console.log(`> Ready on http://${displayHostname}:${port}`)

    // Show network access URL if listening on all interfaces
    if (hostname === '0.0.0.0') {
      // Get local IP address
      const networkInterfaces = os.networkInterfaces()
      let localIP = 'localhost'

      for (const interfaceName in networkInterfaces) {
        const addresses = networkInterfaces[interfaceName]
        if (addresses) {
          for (const addr of addresses) {
            if (addr.family === 'IPv4' && !addr.internal) {
              localIP = addr.address
              break
            }
          }
          if (localIP !== 'localhost') break
        }
      }

      console.log(`> Network access: http://${localIP}:${port}`)
      console.log(`> Access from other devices on the same network using the above URL`)
    }

    // Signal PM2 that the app is ready
    if (process.send) {
      process.send('ready')
    }
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${port} is already in use.`)
      console.error(`\nPlease either:`)
      console.error(`1. Stop the process using port ${port}:`)
      console.error(`   lsof -ti:${port} | xargs kill -9`)
      console.error(`2. Use a different port:`)
      console.error(`   PORT=3001 npm run dev`)
      console.error(`\n`)
      process.exit(1)
    } else {
      throw err
    }
  })

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`> ${signal} received, shutting down gracefully...`)
    server.close(() => {
      console.log('> HTTP server closed')
      process.exit(0)
    })

    // Force shutdown after 15s if graceful shutdown fails
    setTimeout(() => {
      console.error('> Forced shutdown after timeout')
      process.exit(1)
    }, 15000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
})


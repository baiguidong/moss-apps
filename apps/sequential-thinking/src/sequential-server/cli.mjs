// Set before importing upstream: never log thought content to stderr.
process.env.DISABLE_THOUGHT_LOGGING = 'true'
await import('@modelcontextprotocol/server-sequential-thinking/dist/index.js')

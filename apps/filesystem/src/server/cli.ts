import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { resolveSettings } from './settings'
import { absolutePath, directories } from './paths'
const settings = await resolveSettings(JSON.parse(process.argv[2] || '{}'))
// Each conversation has its own MCP process. The Host injects its workspace at
// launch; shared settings contain only the additional, user-configured roots.
const workspace = process.env.MOSS_SESSION_WORKSPACE
if (workspace) await directories([workspace])
const roots = [...new Set([...(workspace ? [absolutePath(workspace)] : []), ...settings.directories])]
// Scope is already bound before serving requests. Ignore subsequent client
// Roots changes, which must not replace the workspace + App directory union.
Server.prototype.listRoots = async () => ({ roots: [] })
const connect = Server.prototype.connect
Server.prototype.connect = function (...args) {
  // The pinned upstream's initialization only negotiates Roots. Skip it so
  // App-level inspection can list tools with an empty, inaccessible scope.
  this.oninitialized = () => {}
  return connect.apply(this, args)
}
process.argv = [process.argv[0], process.argv[1], ...roots]
await import('@modelcontextprotocol/server-filesystem/dist/index.js')

import vm from 'vm'
import {
  WORKFLOW_DATE_BANNED_MESSAGE,
  WORKFLOW_IMPORT_BANNED_MESSAGE,
  WORKFLOW_RANDOM_BANNED_MESSAGE,
} from './constants.js'

export type WorkflowCompileResult =
  | { ok: true; vmScript: vm.Script }
  | { ok: false; error: string }

/**
 * Remove the two sources of nondeterminism that would break resume.
 *
 * A resumed run replays cached Agent results by stable node instance. A node
 * whose result depends on wall-clock time or randomness could still select a
 * different branch on replay, so both APIs throw instead of pretending to be
 * deterministic.
 *
 * Installed on the context (not prepended to the script) so `globalThis.Date`
 * and an aliased `const r = Math.random` are covered too.
 */
export function installDeterminismGuards(context: vm.Context): void {
  vm.runInContext(
    `(() => {
      const dateMessage = ${JSON.stringify(WORKFLOW_DATE_BANNED_MESSAGE)}
      const randomMessage = ${JSON.stringify(WORKFLOW_RANDOM_BANNED_MESSAGE)}
      const RealDate = Date
      globalThis.Date = new Proxy(RealDate, {
        apply() {
          throw new Error(dateMessage)
        },
        construct(target, argv, newTarget) {
          if (argv.length === 0) throw new Error(dateMessage)
          return Reflect.construct(target, argv, newTarget === undefined ? target : newTarget)
        },
        get(target, prop, receiver) {
          if (prop === 'now') throw new Error(dateMessage)
          return Reflect.get(target, prop, receiver)
        },
      })
      Math.random = () => {
        throw new Error(randomMessage)
      }
    })()`,
    context,
    { filename: 'workflow-guards.js' },
  )
}

/**
 * Compile a synchronous node body into a `vm.Script`.
 *
 * The body runs inside a synchronous IIFE, so a bare top-level `return` is
 * supported. Dynamic `import()` is refused at the module-resolution hook, and
 * Promise-like results are rejected by the executor.
 */
export function compileWorkflowCode(
  scriptBody: string,
  filename = 'workflow-node.js',
): WorkflowCompileResult {
  const source = `globalThis.__workflowResult = (() => {\n${scriptBody}\n})()`
  try {
    // Bun's vm.Script defers some syntax errors until runInContext(). Compile
    // the function body once up front so approval never launches a malformed
    // definition. The function is never invoked.
    vm.compileFunction(scriptBody, [], { filename })
    const vmScript = new vm.Script(source, {
      filename,
      importModuleDynamically: () => {
        throw new Error(WORKFLOW_IMPORT_BANNED_MESSAGE)
      },
    })
    return { ok: true, vmScript }
  } catch (error) {
    return {
      ok: false,
      error: `SyntaxError: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

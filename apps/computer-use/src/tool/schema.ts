import { z } from 'zod/v4'

const app = {
  app: z.string().min(1).describe('Exact opaque bundleId returned by list_apps (macOS Bundle ID or Windows executable/launch identity); a unique exact application name is also accepted.'),
}
const window = {
  ...app,
  window_id: z.string().regex(/^[1-9]\d*$/).describe('Exact window_id from list_windows, kept as a decimal string.'),
}
const snapshot = {
  ...window,
  snapshot_id: z.string().min(1).describe('snapshot_id from the latest get_window_state for this window. Valid for one action and at most 60 seconds; observe again after each action or refusal.'),
}
const elementToken = z.string().regex(/^s[0-9a-f]{8}:\d+$/)
  .describe('Exact element_token from the latest observation. Prefer an enabled element with appropriate role/actions. Use this token OR x AND y, never both addressing modes.')
const target = {
  ...snapshot,
  element_token: elementToken.optional(),
  x: z.number().nonnegative().optional().describe('X in returned window screenshot pixels from the top-left corner. Supply y too; omit element_token. Do not use desktop coordinates or unconverted accessibility frame coordinates.'),
  y: z.number().nonnegative().optional().describe('Y in the same window screenshot pixels as x. Supply x too; omit element_token.'),
  foreground: z.boolean().optional().describe('Default false: best-effort background delivery. Set true only after fresh observation confirms background failure; Moss requests foreground authorization for this run.'),
}
const modifiers = z.array(z.enum(['cmd', 'shift', 'option', 'alt', 'ctrl', 'fn', 'win'])).max(5)
const key = z.string().min(1).max(40)
  .describe('One key: return, tab, escape, up/down/left/right, space, delete, home, end, pageup, pagedown, f1-f12, or a letter/digit.')

export const computerUseOperationSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('status') })
    .describe('Read readiness, system permissions, authorized apps and current control owner. No other parameters.'),
  z.strictObject({ action: z.literal('list_apps'),
    query: z.string().optional().describe('Case-insensitive substring of application name or bundleId. Omit to list all discoverable desktop apps.'),
  }).describe('Discover applications, exact bundleId and running state.'),
  z.strictObject({ action: z.literal('launch_app'), ...app })
    .describe('Launch a discovered application after application authorization; then list its windows.'),
  z.strictObject({ action: z.literal('list_windows'), ...app })
    .describe('List windows of a running application. Select the exact window_id for observation.'),
  z.strictObject({ action: z.literal('get_window_state'), ...window,
    query: z.string().optional().describe('Case-insensitive accessibility tree filter: matching rows plus ancestors, with unchanged identifiers. Does not guarantee an exhaustive tree walk.'),
    include_screenshot: z.boolean().optional().describe('Default true: screenshot plus accessibility elements. False returns accessibility only; pixel actions require another observation with a valid screenshot.'),
    max_elements: z.number().int().min(1).max(1500).optional().describe('accessibility element budget: default 600, maximum 1500. Inspect truncated and elements_complete before concluding a control is absent.'),
    max_depth: z.number().int().min(1).max(40).optional().describe('accessibility depth limit: default 25, maximum 40. Increase for deeply nested controls. The Host also limits the walk to 5 seconds.'),
  }).describe('Observe the exact window: fresh snapshot, accessibility elements, completeness metadata and optional screenshot (long edge at most 1440 pixels).'),
  z.strictObject({ action: z.literal('click'), ...target,
    button: z.enum(['left', 'right', 'middle']).optional().describe('Default left. With an accessibility token, right requests the context menu; middle may require the pixel route.'),
    count: z.number().int().min(1).max(2).optional().describe('Pixel clicks only: 1 (default) or 2 for double-click. Omit for accessibility actions.'),
    ax_action: z.enum(['press', 'show_menu', 'pick', 'confirm', 'cancel', 'open', 'invoke', 'expand']).optional().describe('accessibility token only. Match an observed action (AXPress → press, AXShowMenu → show_menu); macOS default press; Windows default invoke, expand opens a dropdown. Use only platform-supported actions.'),
    modifier: modifiers.optional().describe('Click modifiers, e.g. ["shift"]. Modified clicks may need foreground delivery; observe after refusal before requesting it.'),
  }).describe('Activate an accessibility element or click screenshot pixels. Requires element_token OR the pair x,y.'),
  z.strictObject({ action: z.literal('type_text'), ...target,
    text: z.string().min(1).max(10000).describe('Insert at the cursor/selection; does not replace the whole field implicitly. Maximum 10000 characters; the driver may report a smaller safe chunk size.'),
  }).describe('Insert text into a token-addressed field, pixel-focus a field and type, or use the already focused field. Use key actions for Return/Escape.'),
  z.strictObject({ action: z.literal('press_key'), ...target, key,
    modifiers: modifiers.optional().describe('Optional modifiers for this single key, e.g. ["shift"].'),
  }).describe('Press one key in the exact window, optionally focusing an element or pixel-addressed field first.'),
  z.strictObject({ action: z.literal('hotkey'), ...target,
    keys: z.array(z.string().min(1).max(40)).min(2).max(6)
      .describe('Modifiers first, exactly one non-modifier last, e.g. ["cmd","a"] or ["cmd","shift","z"]. Uses press_key key names.'),
  }).describe('Send a keyboard chord. Delivered input is not proof of its effect; observe afterward.'),
  z.strictObject({ action: z.literal('scroll'), ...target,
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(50).optional().describe('Default 3. Wheel notches with a token or x,y; key repetitions without an element/pixel target.'),
    by: z.enum(['line', 'page']).optional().describe('Default line (smaller step); page requests a larger step.'),
  }).describe('Scroll a token/pixel-addressed region with wheel events, or the focused region with keys when no target is supplied. Target nested scrollers explicitly.'),
  z.strictObject({ action: z.literal('set_value'), ...snapshot, element_token: elementToken,
    value: z.string().max(10000).describe('Full accessibility value, or matching option label/value for a supported popup/select. Respect min/max. Empty string can clear a supported native text field.'),
  }).describe('Set a supported accessibility value (slider, stepper, native field or select). Requires a token; no pixel/foreground mode. Use type_text for free-form web/Electron input.'),
  z.strictObject({ action: z.literal('end_session') })
    .describe('Release this conversation\'s current control run and snapshots; conversation application grants remain. No other parameters.'),
])

// Keep the provider envelope an object, with the action union inside it.
// Generate model-visible fields and local parsing from the same definition.
export const computerUseInputSchema = z.strictObject({
  request: computerUseOperationSchema.describe('Exactly one operation. Include only parameters declared for its action.'),
})
const { $schema, ...jsonSchema } = z.toJSONSchema(computerUseInputSchema)
export const computerUseInputJSONSchema = jsonSchema as Record<string, unknown> & { type: 'object' }
export type ComputerUseOperation = z.infer<typeof computerUseOperationSchema>

/** Cross-field addressing rules, in addition to the action-specific schema. */
export function validateComputerUseOperation(request: ComputerUseOperation): string | undefined {
  if ('snapshot_id' in request && request.action !== 'set_value') {
    const hasToken = request.element_token !== undefined
    const hasX = request.x !== undefined
    const hasY = request.y !== undefined
    if (hasX !== hasY) return 'Supply both x and y from the same window screenshot.'
    if (hasToken && hasX) return 'Use element_token OR x and y; do not mix the two addressing modes.'
    if (request.action === 'click') {
      if (!hasToken && !hasX) return 'click requires element_token or both x and y.'
      if (hasToken && request.count !== undefined) return 'count is for pixel clicks; omit it for an accessibility element action.'
      if (!hasToken && request.ax_action !== undefined) return 'ax_action requires element_token; omit it for a pixel click.'
    }
  }
  return undefined
}

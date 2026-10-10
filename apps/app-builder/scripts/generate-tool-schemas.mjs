import fs from 'node:fs/promises'
import { contracts } from '../../../vendor/moss-core/packages/host-contracts/src/index.mjs'
import { toolRoutes } from '../src/backend/actions.mjs'

const extra = {
  guidance: { type: 'object', properties: {}, required: [] },
  skill: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Skill directory relative to the ordinary session workspace.' } }, required: ['path'] },
  operation: { ...contracts['moss.apps/v1'].methods['build.get'].input, properties: { ...contracts['moss.apps/v1'].methods['build.get'].input.properties, family: { enum: ['build', 'release', 'artifact'] } }, required: ['family', 'operationRef'] },
}
for (const [tool, routes] of Object.entries(toolRoutes)) {
  const inputs = Object.fromEntries(Object.entries(routes).map(([operation, [protocol, method]]) => [operation, structuredClone(contracts[protocol].methods[method].input)]))
  if (tool === 'builder_inspect') {
    Object.assign(inputs, extra)
    // The App supplies these fixed catalog kinds, so they are not model inputs.
    for (const name of ['apps', 'projects']) inputs[name] = { type: 'object', properties: {}, required: [] }
  }
  if (tool === 'builder_prepare') Object.assign(inputs.project.properties, {
    title: { type: 'string', maxLength: 160 }, requirements: { type: 'string', maxLength: 12000 }, analysis: { type: 'string', maxLength: 12000 },
  })
  const properties = {}, operations = []
  for (const [operation, input] of Object.entries(inputs)) {
    const required = input.required || []
    operations.push(`${operation}: ${Object.keys(input.properties).map(key => `${key}${required.includes(key) ? ' (required)' : ''}`).join(', ') || 'no other arguments'}`)
    for (const [key, schema] of Object.entries(input.properties)) {
      const existing = properties[key]
      if (!existing) properties[key] = structuredClone(schema)
      else if (JSON.stringify(existing) !== JSON.stringify(schema)) {
        const variants = existing.anyOf || [existing]
        if (!variants.some(value => JSON.stringify(value) === JSON.stringify(schema))) variants.push(structuredClone(schema))
        properties[key] = { anyOf: variants }
      }
    }
  }
  const schema = { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { enum: Object.keys(inputs), description: operations.join('; ') }, ...properties,
  } }
  if (schema.properties.kind) schema.properties.kind.description = 'For contracts/contract: manifest, ui, backend, host, event, sdk or validation. List contracts first to obtain exact kind/member pairs.'
  const file = new URL(`../schemas/${tool}.json`, import.meta.url), content = JSON.stringify(schema, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (await fs.readFile(file, 'utf8') !== content) throw new Error(`${tool} schema differs from the pinned Host contracts`)
  } else await fs.writeFile(file, content)
}

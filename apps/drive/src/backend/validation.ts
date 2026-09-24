import { compileJsonSchema, AppServiceError } from '@moss/app-sdk'
import type { DriveMethod } from '../contracts'
import schema0 from '../../schemas/status.get.output.json'
import schema1 from '../../schemas/quota.get.output.json'
import schema2 from '../../schemas/files.list.output.json'
import schema3 from '../../schemas/local-files.pick.output.json'
import schema4 from '../../schemas/uploads.start.output.json'
import schema5 from '../../schemas/downloads.start.output.json'
import schema6 from '../../schemas/transfers.list.output.json'
import schema7 from '../../schemas/transfers.get.output.json'
import schema8 from '../../schemas/transfers.pause.output.json'
import schema9 from '../../schemas/transfers.resume.output.json'
import schema10 from '../../schemas/transfers.cancel.output.json'
import folderSchema from '../../schemas/folders.create.output.json'
import deleteSchema from '../../schemas/files.delete.output.json'

const validators = {
  'status.get': compileJsonSchema(schema0),
  'quota.get': compileJsonSchema(schema1),
  'files.list': compileJsonSchema(schema2),
  'folders.create': compileJsonSchema(folderSchema),
  'files.delete': compileJsonSchema(deleteSchema),
  'local-files.pick': compileJsonSchema(schema3),
  'uploads.start': compileJsonSchema(schema4),
  'downloads.start': compileJsonSchema(schema5),
  'transfers.list': compileJsonSchema(schema6),
  'transfers.get': compileJsonSchema(schema7),
  'transfers.pause': compileJsonSchema(schema8),
  'transfers.resume': compileJsonSchema(schema9),
  'transfers.cancel': compileJsonSchema(schema10),
}

export function validatedResult(method: DriveMethod, data: unknown) {
  const result = { ok: true as const, data }
  if (!validators[method](result)) throw new AppServiceError('APP_HOST_PROTOCOL', 'Invalid cloud storage response')
  return result
}

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { inspect, validate, execute } from '../src/backend/engine.mjs'

test('Chinese form filling preserves fields, supports selection, rejects invalid values and flattens on request', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-form-'))
  try {
    const doc = await PDFDocument.create(), page = doc.addPage(), form = doc.getForm()
    const name = form.createTextField('name'); name.addToPage(page, { x: 40, y: 650, width: 200, height: 35 })
    const check = form.createCheckBox('confirmed'); check.addToPage(page, { x: 40, y: 600, width: 20, height: 20 })
    const select = form.createDropdown('region'); select.addOptions(['North', 'South']); select.addToPage(page, { x: 40, y: 550, width: 200, height: 35 })
    const readonly = form.createTextField('readonly'); readonly.setText('unchanged'); readonly.enableReadOnly(); readonly.addToPage(page)
    const source = path.join(directory, 'form.pdf'); const original = await doc.save(); await fs.writeFile(source, original)
    const file = { id: 'source', path: source, ...(await inspect(source)) }
    assert.equal(file.metadata.fields.length, 4)
    const context = { files: [file], outputDir: directory, signal: new AbortController().signal, progress() {} }
    const request = fields => validate({ fileIds: ['source'], options: { mode: 'form', fields } }, [file])
    const input = request({ name: '张三 中文测试', confirmed: true, region: 'South' })
    const result = await execute({ ...context, input })
    const filled = await PDFDocument.load(await fs.readFile(result.files[0].path))
    assert.equal(filled.getForm().getTextField('name').getText(), '张三 中文测试')
    assert.equal(filled.getForm().getCheckBox('confirmed').isChecked(), true)
    assert.deepEqual(filled.getForm().getDropdown('region').getSelected(), ['South'])
    assert.equal(filled.getForm().getTextField('readonly').getText(), 'unchanged')
    assert.deepEqual(await fs.readFile(source), Buffer.from(original))
    for (const fields of [{ missing: 'x' }, { readonly: 'x' }, { confirmed: 'yes' }, { region: 'bad' }]) await assert.rejects(execute({ ...context, input: request(fields) }))
    input.options.flatten = true
    const flat = await execute({ ...context, input })
    assert.equal((await PDFDocument.load(await fs.readFile(flat.files[0].path))).getForm().getFields().length, 0)
    const extracted = await execute({ ...context, files: [{ ...file, path: flat.files[0].path }], input: validate({ fileIds: ['source'], options: { mode: 'extract' } }, [file]) })
    assert.match(await fs.readFile(extracted.files[0].path, 'utf8'), /张三.*中文测试/)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

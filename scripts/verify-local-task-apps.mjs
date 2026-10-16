// Requires a complete Core checkout. No changes to the user's Moss profile.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const repo = fileURLToPath(new URL('..', import.meta.url))
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const appRequire = createRequire(path.join(repo, 'apps/pdf-tools/package.json'))
const imageRequire = createRequire(path.join(repo, 'apps/image-tools/package.json'))
const transcribeRequire = createRequire(path.join(repo, 'apps/transcription/package.json'))
const { _electron: electron, expect } = appRequire('@playwright/test')
const { build } = appRequire('vite'), { default: react } = appRequire('@vitejs/plugin-react')
const requireCore = createRequire(path.join(core, 'ui/package.json'))
const sharp = imageRequire('sharp'), { PDFDocument, StandardFonts, rgb } = appRequire('pdf-lib')
const report = path.join(repo, 'artifacts/local-task-apps/verification')
await fs.mkdir(report, { recursive: true })
const styles = path.join(report, 'shell.css'), shell = path.join(report, 'shell/index.html')
await fs.writeFile(styles, [
  `@import ${JSON.stringify(path.join(core, 'ui/src/renderer-react/globals.css'))};`,
  `@source ${JSON.stringify(path.join(core, 'ui/src/renderer-react/components/embedded-app-view.tsx'))};`,
  `@source ${JSON.stringify(path.join(core, 'ui/src/renderer-react/components/ui/button.tsx'))};`,
].join('\n'))
await build({ configFile: false, root: path.join(repo, 'scripts/local-tasks-verify'), base: './', plugins: [react()], logLevel: 'warn',
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    react: path.dirname(appRequire.resolve('react/package.json')), 'react-dom': path.dirname(appRequire.resolve('react-dom/package.json')),
    '@': path.join(core, 'ui/src/renderer-react'), 'moss-core-embedded-view': path.join(core, 'ui/src/renderer-react/components/embedded-app-view.tsx'), 'moss-core-global-style': styles,
  } }, css: { postcss: { plugins: [requireCore('@tailwindcss/postcss')()] } }, build: { outDir: path.dirname(shell), emptyOutDir: true } })
const fixtures = path.join(report, 'fixtures'); await fs.mkdir(fixtures, { recursive: true })
const imageFile = path.join(fixtures, '山间日落.tiff')
await sharp(Buffer.from('<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#303f66"/><stop offset="1" stop-color="#e5ad7c"/></linearGradient></defs><rect width="960" height="640" fill="url(#sky)"/><circle cx="680" cy="210" r="76" fill="#ffdb9c"/><path d="M0 480L270 210L500 490L720 340L960 480V640H0" fill="#48636c"/><path d="M0 580L400 390L720 590L960 500V640H0" fill="#243f4b"/></svg>')).tiff().toFile(imageFile)
const pdfFile = path.join(fixtures, '工作资料.pdf'), pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica)
for (const title of ['MOSS LOCAL DOCUMENT', 'SECOND PAGE']) {
  const p = pdf.addPage([595, 842]); p.drawText(title, { x: 60, y: 740, size: 26, font, color: rgb(.1, .3, .3) })
  p.drawText('Organize, search and export without leaving Moss.', { x: 60, y: 680, size: 14, font })
}
const scan = await sharp(Buffer.from('<svg width="1000" height="1400" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1400" fill="white"/><text x="90" y="200" font-family="Arial" font-size="48">MOSS SCANNED DOCUMENT</text><text x="90" y="300" font-family="Arial" font-size="30">Everything stays on this computer.</text><text x="90" y="420" font-family="PingFang SC" font-size="46">本地文档测试</text></svg>')).png().toBuffer()
const png = await pdf.embedPng(scan); pdf.addPage([500,700]).drawImage(png, { x:0,y:0,width:500,height:700 }); await fs.writeFile(pdfFile, await pdf.save())
const audioFile = process.env.MOSS_TEST_AUDIO || '/opt/homebrew/Cellar/whisper-cpp/1.9.1/share/whisper-cpp/jfk.wav'
const videoFile = path.join(fixtures, '演讲片段.mp4')
const ffmpeg = path.join(path.dirname(transcribeRequire.resolve('@drbearzay/ffmpeg-darwin-arm64/package.json')), 'ffmpeg')
await fs.chmod(ffmpeg, 0o755)
execFileSync(ffmpeg, ['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=0x243f4b:s=320x240:r=10','-i',audioFile,'-c:v','mpeg4','-c:a','aac','-shortest','-y',videoFile])
const model = process.env.MOSS_TEST_MODEL || path.join(repo, 'artifacts/local-task-apps/transcription-data/models/ggml-base.bin')
const names = process.argv.includes('--app') ? [process.argv[process.argv.indexOf('--app') + 1].replace(/^moss\./, '')] : ['image-tools','pdf-tools','transcription']
process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'
for (const name of names) {
  const appId = `moss.${name}`, checks = [], errors = [], output = path.join(report, name)
  await fs.mkdir(output, { recursive: true })
  const desktop = await electron.launch({ executablePath: path.join(core, 'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.join(repo, 'scripts/local-tasks-verify/desktop.cjs')],
    env: { ...process.env, MOSS_CORE_ROOT: core, MOSS_TEST_APP: appId, MOSS_TEST_VERSION: '0.1.1', MOSS_TEST_NODE: process.execPath, MOSS_TEST_SHELL: shell, MOSS_TEST_MODEL: model,
      MOSS_TEST_ARCHIVE: path.join(repo, 'artifacts', appId, '0.1.1', `${appId}-0.1.1-darwin-arm64.zip`) }, timeout: 60000 })
  let directory, page
  const passed = message => { checks.push(message); console.log(`PASS ${name}: ${message}`) }
  try {
    const shellPage = await desktop.firstWindow({ timeout: 60000 }); await expect(shellPage.locator('webview')).toBeVisible({ timeout: 30000 })
    const isApp = page => page.url().includes('/dist/ui/index.html')
    page = desktop.context().pages().find(isApp) || await desktop.context().waitForEvent('page', { predicate: isApp, timeout: 30000 })
    directory = await desktop.evaluate(() => globalThis.localTaskFixture.directory)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') console.error(name, message.text().slice(0,400)) })
    const invoke = (action, input = {}) => desktop.evaluate((_electron, args) => globalThis.localTaskFixture.invoke(...args), [action,input])
    const tool = (action, input = {}) => desktop.evaluate((_electron, args) => globalThis.localTaskFixture.invokeTool(...args), [action,input])
    const pick = paths => desktop.evaluate((_electron, paths) => globalThis.localTaskFixture.pick(paths), paths)
    const click = async locator => {
      await expect(locator).toBeVisible(); await expect(locator).toBeEnabled(); await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox(); assert(box)
      await desktop.evaluate((_electron, point) => globalThis.localTaskFixture.click(point), { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })
    }
    const enter = async (locator, text) => { await locator.focus(); await locator.evaluate(el => el.select()); await desktop.evaluate((_electron, text) => globalThis.localTaskFixture.insertText(text), text); await expect(locator).toHaveValue(text) }
    const waitTask = async id => {
      let task
      await expect.poll(async () => { task = (await invoke('workspace.get')).tasks.find(t => !id || t.id === id); return task && ['succeeded','failed','canceled'].includes(task.status) }, { timeout: 180000, intervals: [300,500,1000] }).toBe(true)
      assert.equal(task.status, 'succeeded', task.message); return task
    }
    const startTask = async locator => {
      const previous = new Set((await invoke('workspace.get')).tasks.map(task => task.id))
      await click(locator)
      let id
      await expect.poll(async () => { id = (await invoke('workspace.get')).tasks.find(task => !previous.has(task.id))?.id; return Boolean(id) }, { timeout: 30000 }).toBe(true)
      const task = await waitTask(id)
      await expect(page.locator('.result-tile')).toHaveCount((await invoke('workspace.get')).files.filter(file => file.role === 'output').length)
      return task
    }
    const screenshot = async suffix => { await page.evaluate(() => scrollTo(0,0)); await page.waitForTimeout(150); await fs.writeFile(path.join(output, suffix + '.png'), Buffer.from(await desktop.evaluate(() => globalThis.localTaskFixture.screenshot()), 'base64')) }
    await expect(page.getByRole('button', { name:'导入文件',exact:true })).toBeEnabled({ timeout:30000 })
    assert.equal((await desktop.evaluate(() => globalThis.localTaskFixture.tools(false))).tools.length, 0)
    assert.equal((await desktop.evaluate(() => globalThis.localTaskFixture.tools(true))).tools.length, name === 'image-tools' ? 5 : 3)
    passed('Installed ZIP starts through Core preload; session tools are visible only when selected')
    const exports = path.join(directory, 'exports'); await fs.mkdir(exports)
    if (name === 'image-tools') {
      const imported = await tool('files_import', { paths: [imageFile] }); assert.equal(imported.errors.length,0)
      await expect(page.getByRole('heading', { name:'原图预览' })).toBeVisible()
      await expect.poll(() => page.locator('.image-wrap img').evaluate(el => el.naturalWidth)).toBe(960)
      await click(page.getByRole('button',{name:'尺寸与填充',exact:true}))
      await enter(page.getByLabel('目标宽度',{exact:true}), '480')
      await startTask(page.getByRole('button',{name:'开始处理',exact:true}))
      await click(page.locator('.result-tile').first())
      await expect(page.getByLabel('图片前后对比')).toBeVisible()
      const result = (await invoke('workspace.get')).files.find(f=>f.role==='output')
      const bytes = Buffer.from(await (await fetch(result.url)).arrayBuffer()); assert.equal((await sharp(bytes).metadata()).width,480)
      await pick([exports]); await click(page.getByRole('button',{name:'导出结果',exact:true})); await expect(page.getByRole('status')).toContainText('已导出 1')
      await pick([exports]); await click(page.getByRole('button',{name:'导出结果',exact:true})); await expect.poll(async()=> (await fs.readdir(exports)).length).toBe(2)
      passed('AI import of TIFF appears in UI; bundled sharp converts; comparison preview and non-overwriting export work')
      await expect(page.locator('h1')).toHaveCSS('clip','rect(0px, 0px, 0px, 0px)')
      const capability=shellPage.getByRole('button',{name:/查看 AI 能力：5 个 AI 工具/})
      await expect(capability).toBeVisible();await capability.click()
      await expect(shellPage.locator('[data-app-capabilities]')).toContainText('取消图片处理')
      await expect(shellPage.locator('[data-app-capabilities]')).toContainText('导出图片结果')
      await shellPage.keyboard.press('Escape')
      assert.equal(await page.getByRole('navigation',{name:'图片处理功能'}).getByRole('button').count(),8)
      await click(page.getByLabel('重置处理设置'))
      await click(page.getByRole('button',{name:'裁剪',exact:true}));await click(page.getByRole('button',{name:'裁剪当前图片',exact:true}));await click(page.getByRole('button',{name:'重新框选',exact:true}))
      const img=await page.locator('.image-wrap>img').first().boundingBox();assert(img)
      const drag=(from,to)=>desktop.evaluate((_e,points)=>globalThis.localTaskFixture.drag(points),{from,to})
      await drag({x:img.x+img.width*0.1,y:img.y+img.height*0.1},{x:img.x+img.width*0.6,y:img.y+img.height*0.65})
      const values=async()=>Object.fromEntries(await Promise.all([['left','左边距'],['top','上边距'],['width','裁剪宽度'],['height','裁剪高度']].map(async([key,label])=>[key,Number(await page.getByLabel(label,{exact:true}).inputValue())])))
      const drawn=await values();assert(drawn.width>300&&drawn.left>50)
      const cropBox=await page.getByLabel('裁剪选区',{exact:true}).boundingBox();assert(cropBox)
      await drag({x:cropBox.x+cropBox.width/2,y:cropBox.y+cropBox.height/2},{x:cropBox.x+cropBox.width/2+25,y:cropBox.y+cropBox.height/2+15})
      const moved=await values();assert(moved.left>drawn.left);assert.equal(moved.width,drawn.width)
      const handle=await page.getByLabel('调整裁剪右下',{exact:true}).boundingBox();assert(handle)
      await drag({x:handle.x+handle.width/2,y:handle.y+handle.height/2},{x:handle.x+handle.width/2+20,y:handle.y+handle.height/2+10})
      assert((await values()).width>moved.width)
      await page.getByLabel('裁剪比例',{exact:true}).selectOption('1')
      const fixed=await values();assert.equal(fixed.width,fixed.height)
      const croppedTask=await startTask(page.getByRole('button',{name:'开始处理',exact:true}))
      const cropped=(await invoke('workspace.get')).files.find(f=>f.taskId===croppedTask.id)
      assert.equal(cropped.metadata.width,fixed.width);assert.equal(cropped.metadata.height,fixed.height)
      assert.deepEqual(croppedTask.input.options.crop,fixed)
      passed('Real mouse draws, moves and resizes crop selection; fixed-ratio coordinates produce matching output pixels')
      await screenshot('crop-mouse')
      await click(page.getByLabel('重置处理设置'))
      await click(page.getByRole('button',{name:'旋转与翻转',exact:true}));await click(page.getByRole('button',{name:'90°',exact:true}))
      await expect(page.getByLabel('旋转角度',{exact:true})).toHaveValue('90')
      await click(page.getByRole('button',{name:'色彩调整',exact:true}));await click(page.getByLabel('黑白',{exact:true}))
      await expect(page.getByLabel('黑白',{exact:true})).toBeChecked()
      await click(page.getByRole('button',{name:'文字水印',exact:true}));await click(page.getByLabel('添加文字水印',{exact:true}));await enter(page.getByLabel('水印文字',{exact:true}),'MOSS <&>')
      await expect(page.getByLabel('添加文字水印',{exact:true})).toBeChecked()
      const effects=await startTask(page.getByRole('button',{name:'开始处理',exact:true}))
      assert.equal(effects.input.options.rotation,90);assert(effects.input.options.grayscale);assert.equal(effects.input.options.watermark.text,'MOSS <&>')
      await click(page.locator('.result-tile').last());await expect.poll(()=>page.locator('.image-wrap>img').first().evaluate(el=>el.naturalWidth)).toBe(640)
      const tiffTask=await tool('tasks_start',{fileIds:[imported.files[0].id],options:{format:'tiff',width:200}});await waitTask(tiffTask.id)
      await expect(page.locator('.result-tile')).toHaveCount(4)
      await click(page.locator('.result-tile').last());await expect.poll(()=>page.locator('.image-wrap>img').first().evaluate(el=>el.naturalWidth)).toBe(200)
      passed('Eight UI capability groups, composable rotation/grayscale/watermark, Agent TIFF output and five disclosed tools work')

      await screenshot('result-light')
    } else if (name === 'pdf-tools') {
      await pick([pdfFile]); await click(page.getByRole('button',{name:'导入文件',exact:true}))
      await expect(page.locator('.page-tile')).toHaveCount(3)
      await expect.poll(()=>page.locator('.page-tile canvas').first().evaluate(el=>el.width)).toBeGreaterThan(100)
      await click(page.getByLabel('第1项后移',{exact:true})); await click(page.getByLabel('旋转第1项',{exact:true}))
      await click(page.getByRole('button',{name:'生成 PDF',exact:true})); await waitTask()
      await click(page.locator('.pdf-results button').first())
      await enter(page.getByLabel('搜索 PDF 文字'), 'SECOND')
      await click(page.getByRole('button',{name:'搜索',exact:true})); await expect(page.locator('.search-results button')).toContainText('SECOND PAGE')
      const files = (await invoke('workspace.get')).files, result = files.find(f=>f.role==='output')
      const document = await PDFDocument.load(await (await fetch(result.url)).arrayBuffer()); assert.equal(document.getPageCount(),3); assert.equal(document.getPage(0).getRotation().angle,90)
      await screenshot('arrange-light')
      const input = files.find(f=>f.role==='input')
      const task = await tool('tasks_start', {fileIds:[input.id],options:{mode:'ocr',language:'chi_sim+eng',pages:[{fileId:input.id,page:2,rotation:0}]}})
      await waitTask(task.id)
      const textFile = (await invoke('workspace.get')).files.find(f => f.taskId === task.id && f.kind === 'ocr-text')
      await fs.writeFile(path.join(output, 'ocr-text.json'), await (await fetch(textFile.url)).text())
      await click(page.locator('.pdf-results button').filter({hasText:'可搜索文档.pdf'}))
      await enter(page.getByLabel('搜索 PDF 文字'),'SCANNED'); await expect(page.locator('.search-results button')).toContainText('MOSS SCANNED DOCUMENT')
      await pick([exports]); await click(page.locator('.pdf-toolbar button').filter({hasText:'导出'})); await expect(page.getByRole('status')).toContainText('已导出 1')
      passed('UI reorders and rotates real PDF pages; offline packaged Chinese + English OCR finds scanned text; reader, search and export work')
      await enter(page.getByLabel('搜索 PDF 文字'),'本地'); await expect(page.locator('.search-results button')).toContainText(/本地/); await screenshot('ocr-light')
    } else {
      await pick([videoFile]); await click(page.getByRole('button',{name:'导入文件',exact:true}))
      await page.getByLabel('语音语言').selectOption('en')
      await click(page.getByRole('button',{name:'开始转写',exact:true})); await waitTask()
      await click(page.locator('.transcript-results button').first())
      const segment = page.getByLabel('片段 1',{exact:true}); await expect(segment).toHaveValue(/fellow Americans/i)
      await expect.poll(()=>page.locator('audio').evaluate(el=>el.duration)).toBeGreaterThan(10)
      await click(page.getByLabel('播放 00:00',{exact:true})); await expect.poll(()=>page.locator('audio').evaluate(el=>el.currentTime)).toBeGreaterThan(0)
      await page.locator('audio').evaluate(el=>el.pause())
      await enter(segment, (await segment.inputValue()) + ' [已校对]')
      await click(page.getByRole('button',{name:'保存校对',exact:true})); await expect(page.getByRole('status')).toContainText('校对已保存')
      await pick([exports]); await click(page.getByRole('button',{name:'SRT',exact:true})); await expect(page.getByRole('status')).toContainText('已导出 1')
      assert.match(await fs.readFile(path.join(exports,'逐字稿.srt'),'utf8'),/已校对/)
      const state = await invoke('workspace.get'), file = state.files.find(f=>f.kind==='transcript')
      const transcript = await (await fetch(file.url)).json()
      assert(transcript.segments.every(s => s.start >= 0 && s.end <= transcript.duration && s.end > s.start))
      assert(transcript.segments[1].start > 7 && transcript.segments[1].start < 9)
      await click(page.getByLabel('播放 00:07',{exact:true})); await expect.poll(()=>page.locator('audio').evaluate(el=>el.currentTime)).toBeGreaterThan(7)
      await page.locator('audio').evaluate(el=>el.pause())
      await assert.rejects(invoke('transcript.save',{id:file.id,revision:'stale',segments:[]}),/更新|校对|版本|冲突/)
      passed('Packaged FFmpeg decodes video; real Whisper model transcribes; audio plays inside Moss; edits regenerate exported subtitles')
      await screenshot('transcript-light')
      const input = state.files.find(f=>f.role==='input')
      const pending = await tool('tasks_start',{fileIds:[input.id],options:{language:'en'}})
      await invoke('tasks.cancel',{id:pending.id})
      await expect.poll(async()=> (await invoke('workspace.get')).tasks.find(t=>t.id===pending.id).status,{timeout:15000}).toBe('canceled')
      passed('Running transcription cancels without losing completed results')
      const chineseAudio = process.env.MOSS_TEST_CHINESE_AUDIO || path.join(fixtures, '中文会议.aiff')
      if (await fs.stat(chineseAudio).catch(() => null)) {
        const imported = await tool('files_import', { paths: [chineseAudio] })
        assert.equal(imported.errors.length, 0)
        const task = await tool('tasks_start', { fileIds: [imported.files[0].id], options: { language: 'zh' } })
        await waitTask(task.id)
        const file = (await invoke('workspace.get')).files.find(f => f.taskId === task.id && f.kind === 'transcript')
        const transcript = await (await fetch(file.url)).json()
        assert.match(transcript.segments.map(s => s.text).join(''), /项目|項目|文档|文檔|测试|測試/)
        assert(transcript.segments.every(s => s.end <= transcript.duration))
        await click(page.locator('.transcript-results button').filter({ hasText: '中文会议.aiff' }))
        await expect(page.locator('.segments textarea').first()).toHaveValue(/[\u4e00-\u9fff]/)
        passed('Multilingual model transcribes a Chinese synthetic speech fixture with valid media timestamps')
        await screenshot('chinese-light')
      }
    }
    await desktop.evaluate(()=>globalThis.localTaskFixture.theme('dark')); await expect(page.locator('html')).toHaveAttribute('data-theme','dark'); await screenshot('result-dark')
    await desktop.evaluate(()=>globalThis.localTaskFixture.resize({width:420,height:860})); await page.waitForTimeout(250); await screenshot('result-narrow')
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Narrow UI overflows horizontally')
    await desktop.evaluate(()=>globalThis.localTaskFixture.resize({width:1180,height:880}))
    const before = await invoke('workspace.get'); await desktop.evaluate(()=>globalThis.localTaskFixture.restart()); await desktop.evaluate(()=>globalThis.localTaskFixture.reload())
    await expect(page.getByRole('button',{name:'导入文件',exact:true})).toBeEnabled({timeout:30000})
    const after = await tool('workspace_get'); assert.deepEqual(after.files.map(f=>f.id),before.files.map(f=>f.id)); assert.equal(after.tasks.filter(t=>t.status==='succeeded').length,before.tasks.filter(t=>t.status==='succeeded').length)
    assert.equal((await fetch(after.files.find(f=>f.role==='output').url)).status,200)
    passed('Moss theme changes, narrow layout, Backend restart and restored result previews work')
    await desktop.evaluate(()=>globalThis.localTaskFixture.enabled(false)); await assert.rejects(tool('workspace_get'),/unavailable|disabled|停用|禁用/)
    await desktop.evaluate(()=>globalThis.localTaskFixture.enabled(true)); await tool('workspace_get')
    passed('Disabling the App prevents tool execution; re-enabling restores it')
    assert.deepEqual(errors,[])
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({appId,version:'0.1.1',platform:`${process.platform}-${process.arch}`,checks,pageErrors:errors},null,2)+'\n')
  } catch(error) {
    console.error('App text:', await page?.locator('body').innerText().catch(()=>''))
    if(page) await fs.writeFile(path.join(output,'failure.png'),Buffer.from(await desktop.evaluate(()=>globalThis.localTaskFixture.screenshot()).catch(()=>''),'base64'))
    throw error
  } finally {
    await desktop.evaluate(()=>globalThis.localTaskFixture?.cleanup()).catch(()=>{}); await desktop.close()
    if(directory) await fs.rm(directory,{recursive:true,force:true})
  }
}

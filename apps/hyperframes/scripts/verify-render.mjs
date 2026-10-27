import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import engine from '../src/backend/engine.mjs'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperframes-render-'))
try {
  const actions = new Map(), dataDir = path.join(isolated, 'data')
  await engine.register({ registerAction: (name, handler) => actions.set(name, handler) }, { dataDir })
  const project = await actions.get('projects.create')({ name: '三镜头时间轴回归验证', width: 320, height: 180, duration: 15 })
  const colors = ['#c02020', '#20c020', '#2020c0']
  for (const [index, scene] of project.storyboard.scenes.entries()) {
    await actions.get('projects.scene.save')({ id: project.id, sceneId: scene.id, html: `<article style="height:100%;background:${colors[index]}"><style>@keyframes marker-${index}{from{opacity:0}to{opacity:1}}</style><div style="position:absolute;left:120px;top:60px;width:80px;height:60px;background:white;animation:marker-${index} 2s linear both"></div></article>` })
  }
  await fs.cp(path.join(root, 'dist'), path.join(isolated, 'dist'), { recursive: true })
  const inputFile = path.join(isolated, 'input.json')
  await fs.writeFile(inputFile, JSON.stringify({ operation: 'render', projectId: project.id, fps: 5, quality: 'fast' }))
  const { stdout } = await exec(process.execPath, [path.join(isolated, 'dist/backend/cli.mjs'), 'run', '--data-dir', dataDir, '--input-file', inputFile], {
    cwd: isolated, timeout: 180000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_PATH: '' },
  })
  const task = JSON.parse(stdout)
  assert.equal(task.status, 'succeeded')
  const video = task.artifacts.find(item => item.kind === 'video')
  assert.ok((await fs.stat(video.path)).size > 0)
  const ffprobe = path.join(isolated, 'dist/engines/ffprobe/5.0.1/ffprobe')
  const probe = await exec(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', video.path])
  const metadata = JSON.parse(probe.stdout)
  assert.equal(metadata.streams[0].width, 320)
  assert.equal(metadata.streams[0].height, 180)
  assert.equal(Number(metadata.format.duration), 15)
  assert.equal(Number(metadata.streams[0].nb_frames), 75)
  const ffmpeg = path.join(isolated, 'dist/engines/ffmpeg/8.0.1/ffmpeg')
  const { stdout: frames } = await exec(ffmpeg, ['-v', 'error', '-i', video.path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
  const pixel = (frame, x, y) => [...frames.subarray((frame * 320 * 180 + y * 320 + x) * 3, (frame * 320 * 180 + y * 320 + x) * 3 + 3)]
  const near = (actual, expected, label) => assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 18), `${label}: ${actual} != ${expected}`)
  // Inspect every frame, including both scene boundaries and the final frame.
  for (let frame = 0; frame < 75; frame++) {
    const expected = [32, 32, 32]; expected[Math.floor(frame / 25)] = 192
    near(pixel(frame, 10, 10), expected, `Scene color at ${frame / 5}s`)
    if (frame % 25 === 0) near(pixel(frame, 160, 90), expected, `Animation starts locally at ${frame / 5}s`)
    if (frame % 25 === 15) near(pixel(frame, 160, 90), [255, 255, 255], `Animation finishes locally at ${frame / 5}s`)
  }
  const output = process.env.MOSS_HYPERFRAMES_OUTPUT || path.join(os.tmpdir(), 'hyperframes-redesign')
  await fs.mkdir(output, { recursive: true })
  await fs.copyFile(video.path, path.join(output, 'render-smoke.mp4'))
  console.log(JSON.stringify({ status: task.status, bytes: task.result.bytes, width: 320, height: 180, duration: metadata.format.duration, checkedFrames: 75, localSceneAnimation: true, isolated: true }))
} catch (error) {
  if (error.stdout) console.error(error.stdout)
  throw error
} finally { await fs.rm(isolated, { recursive: true, force: true }) }

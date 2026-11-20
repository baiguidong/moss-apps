// Synthetic projects and task results. Each scenario starts in a fresh conversation.
export const avatar = '95ac11f8-e053-43e4-b830-2eb87567faa6'
export const project = 'project-mos26-0'
export const task = 'b5bad94f-0904-468f-9ad5-29d75210bb27'
export const file = '/samples/访谈.mp4'
const revision = 17
export const projectData = { id: project, kind: 'animation', version: revision, name: '秋季新品', storyboard: { scenes: [
  { id: 'opening', title: '开场', duration: 4, narration: '秋天到了。', visual: '树叶落下' }, { id: 'detail', title: '细节', duration: 6, narration: '看这里。', visual: '相机特写' },
] } }
export const avatarData = { id: avatar, kind: 'avatar', version: 8, name: '欢迎词', script: '上午好。', aspect: '16:9' }
export const taskData = { id: task, status: 'succeeded', artifacts: [
  { name: '试听.wav', kind: 'audio' }, { name: '逐字稿.json', kind: 'transcript' },
  { name: '逐字稿.txt', kind: 'text' }, { name: '逐字稿.vtt', kind: 'text' }, { name: '逐字稿.srt', kind: 'text' },
] }
const read = (type, args = {}) => ['media_get', { type, ...args }]
const edit = (mode, args = {}) => ['media_edit', { mode, path: file, ...args }]
const getTask = read('task', { id: task })
const getAvatar = read('project', { id: avatar })
const getProject = read('project', { id: project })
const transcribe = ['media_transcribe', { path: file, language: 'fr' }]
const srt = { id: task, index: 4 }
const exportSrt = ['media_export', srt]
export const cases = [
  { id: 'inspect', prompt: `${file} 有多长，画面多大？先别改文件。`, steps: [edit('inspect')] },
  { id: 'trim', prompt: `只保留 ${file} 第 3.5 秒到第 12 秒这段。`, steps: [edit('trim', { start: 3.5, end: 12 })] },
  { id: 'extract', prompt: `把 ${file} 里的声音单独拿出来给我一个 WAV。`, steps: [edit('audio')] },
  { id: 'gif', prompt: `把 ${file} 做成 480 像素宽、每秒 8 帧的动图。`, steps: [edit('gif', { width: 480, fps: 8 })] },
  { id: 'transcribe', prompt: `帮我把这场法语采访听写成带时间的字幕，原片在 ${file}。`, steps: [transcribe] },
  { id: 'new-avatar', prompt: '新建数字人口播草稿，名字叫“欢迎词”，讲稿就三个字“下午好”。先存稿。', steps: [
    ['video_project_save', { kind: 'avatar', fields: { name: '欢迎词', script: '下午好' } }],
  ] },
  { id: 'new-animation', prompt: '给我起一个叫“秋季新品”的分镜动画工程，竖屏 9:16，时长 20 秒，先不用出片。', steps: [
    ['video_project_save', { kind: 'animation', animation: { name: '秋季新品', aspectRatio: '9:16', duration: 20 } }],
  ] },
  { id: 'revise-script', prompt: `请把口播项目 ${avatar} 的讲稿改成“下午好。”，保留其他设置。`, steps: [getAvatar,
    ['video_project_save', { id: avatar, version: 8, fields: { script: '下午好。' } }],
  ] },
  { id: 'save-scene', prompt: `分镜项目 ${project} 当前第 17 版。请将 detail 镜头的场景源码原样换成 <h1>新款</h1>。`, steps: [
    ['video_project_save', { id: project, version: revision, sceneId: 'detail', html: '<h1>新款</h1>' }],
  ] },
  { id: 'one-shot-edit', prompt: `分镜项目 ${project} 的第二个镜头加长到 9 秒。其他镜头和现有文案都保留。`, steps: [getProject,
    ['video_project_save', { id: project, version: revision, storyboard: { scenes: [projectData.storyboard.scenes[0], { ...projectData.storyboard.scenes[1], duration: 9 }] } }],
  ] },
  { id: 'speech-only', prompt: `我想先听一下口播项目 ${avatar} 第 8 版的声音，别生成视频。`, steps: [
    ['video_render', { id: avatar, version: 8, output: 'speech' }],
  ] },
  { id: 'render', prompt: `把动画项目 ${project} 已保存的第 17 版出一份每秒 24 帧的 MP4。`, steps: [
    ['video_render', { id: project, version: revision, fps: 24 }], // output defaults to video
  ] },
  { id: 'check-task', prompt: `刚才提交的任务 ${task} 做完了吗？`, steps: [getTask] },
  { id: 'check-scenes', prompt: `帮我检查动画项目 ${project} 的分镜结构和场景是否有效，先别出片。`, steps: [read('validate', { id: project })] },
  { id: 'list-projects', prompt: '有哪些已经保存的视频项目？给我最近的 5 个。', steps: [read('projects', { limit: 5 })] },
  { id: 'history', prompt: '最近处理过哪些任务？列出最新的 3 条。', steps: [read('tasks', { limit: 3 })] },
  { id: 'voices', prompt: '本机数字人口播现在能选哪些声音和角色？', steps: [read('settings')] },
  { id: 'read-srt', prompt: `给我看任务 ${task} 生成的 SRT 原文，直接贴出来就行。`, steps: [getTask, ['media_get', { type: 'artifact', ...srt }]] },
  { id: 'export-srt', prompt: `把任务 ${task} 已经生成的 SRT 单独存到我选的文件夹。`, steps: [getTask, exportSrt] },
  { id: 'cancel', prompt: `停掉任务 ${task}，别让它继续跑了。`, steps: [['media_cancel', { id: task }]] },
  { id: 'transcribe-and-export', prompt: `把 ${file} 里的法语访谈做成 SRT，再把生成的字幕文件存到我选的文件夹。`, steps: [transcribe, getTask, exportSrt] },
  { id: 'missing-file', prompt: '我有一段录音想转成字幕。还没发给你，也没提供文件位置。', steps: [], reply: '需要用户提供文件或路径' },
  { id: 'speech-on-animation', prompt: `给分镜动画项目 ${project} 第 17 版直接试听数字人口播配音，不要另建项目，也不要出视频。`, steps: [], optionalReads: [getProject], reply: '说明动画不支持口播试听' },
  { id: 'engine-version', group: 'coverage', prompt: '请用工坊工具查本机当前实际安装的 FFmpeg 和 ffprobe 版本，给我具体版本号。都不处理文件。', steps: [], optionalReads: [read('settings')], reply: '说明当前工具查不到实际版本' },
  { id: 'import-only', group: 'coverage', prompt: `只把 ${file} 复制到工坊的转写素材库。我以后手动点开始，现在别识别，也别处理它。`, steps: [], reply: '说明需要在转写页面导入' },
]

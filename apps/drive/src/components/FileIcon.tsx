import { File, FileArchive, FileCode2, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo, Folder } from 'lucide-react'
export function FileIcon({ name, folder = false }: { name: string; folder?: boolean }) {
  const ext = name.split('.').at(-1)?.toLowerCase() || ''
  const Icon = folder ? Folder : /^(png|jpe?g|gif|webp|svg|heic)$/.test(ext) ? FileImage
    : /^(zip|rar|7z|gz|tar)$/.test(ext) ? FileArchive : /^(csv|xlsx?|numbers)$/.test(ext) ? FileSpreadsheet
    : /^(mp4|mov|webm|mkv)$/.test(ext) ? FileVideo : /^(mp3|wav|flac|m4a)$/.test(ext) ? FileMusic
    : /^(json|js|ts|tsx|html|css|py|go|rs)$/.test(ext) ? FileCode2 : /^(pdf|md|txt|docx?)$/.test(ext) ? FileText : File
  return <span className={`file-icon ${folder ? 'folder-icon' : ''}`} aria-hidden="true"><Icon size={22} strokeWidth={1.65} /></span>
}

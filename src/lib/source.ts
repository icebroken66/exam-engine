import type { SourceStatus } from './api'

const STATUS_LABELS: Record<SourceStatus, string> = {
  uploaded: '待加入解析',
  queued: '解析已排队',
  running: '正在解析',
  needs_review: '需要人工确认',
  needs_transcription_review: '转录待确认',
  ready: '证据可用',
  failed: '解析失败',
}

export function sourceStatusLabel(status: SourceStatus): string {
  return STATUS_LABELS[status]
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

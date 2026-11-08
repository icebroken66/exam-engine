import type { Source, SourceStatus } from './api'

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

const PROCESSING_LABELS: Record<string, string> = {
  extracting: '正在提取正文',
  transcribing: '正在检查并转录扫描页',
  classifying: '正在识别资料类型',
  exam_extraction: '正在逐题抽取',
  exam_solving: '正在逐题处理与求解',
  exam_validation: '正在独立验收题目',
}

export function sourceProcessingLabel(source: Source): string {
  const label = PROCESSING_LABELS[source.processing_stage] || sourceStatusLabel(source.status)
  return source.processing_total > 0
    ? `${label} ${source.processing_completed}/${source.processing_total}`
    : label
}

export function formatProcessingDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  if (rounded < 60) return `${rounded} 秒`
  return `${Math.floor(rounded / 60)} 分 ${rounded % 60} 秒`
}

export function sourceElapsedSeconds(source: Source, now = Date.now()): number {
  if (source.status !== 'running' || !source.processing_started_at) return source.processing_duration_seconds
  const started = source.processing_started_at
  const timestamp = Date.parse(/Z$|[+-]\d\d:\d\d$/.test(started) ? started : `${started}Z`)
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 1000) : 0
}

export function daysUntil(date: string | null, today = new Date()): number | null {
  if (!date) return null
  const target = new Date(`${date}T00:00:00`)
  const current = new Date(today)
  current.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - current.getTime()) / 86_400_000)
}

export function examCountdown(date: string | null, today = new Date()): string {
  const days = daysUntil(date, today)
  if (days === null) return '尚未设置考试日'
  if (days < 0) return `已考 ${Math.abs(days)} 天`
  if (days === 0) return '今天考试'
  return `距考试 ${days} 天`
}

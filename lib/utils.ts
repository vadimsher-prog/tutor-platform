import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'd MMMM yyyy', { locale: ru })
}

export function formatDateTime(dateStr: string): string {
  return format(parseISO(dateStr), 'd MMM, HH:mm', { locale: ru })
}

export function formatTime(dateStr: string): string {
  return format(parseISO(dateStr), 'HH:mm')
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount)
}

export function tariffLabel(type: string): string {
  const map: Record<string, string> = {
    per_lesson: 'По занятию',
    package: 'Пакет',
    monthly: 'Помесячно',
  }
  return map[type] ?? type
}

export function lessonStatusLabel(status: string): string {
  const map: Record<string, string> = {
    scheduled: 'Запланировано',
    completed: 'Проведено',
    cancelled: 'Отменено',
    rescheduled: 'Перенесено',
  }
  return map[status] ?? status
}

export function lessonStatusColor(status: string): string {
  const map: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    rescheduled: 'bg-yellow-100 text-yellow-800',
  }
  return map[status] ?? 'bg-gray-100 text-gray-800'
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

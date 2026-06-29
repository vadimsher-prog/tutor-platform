'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

function jsDayToOur(jsDay: number): number { return (jsDay + 6) % 7 }

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart)
}

function formatRuDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]}, ${DAYS_FULL[jsDayToOur(d.getDay())]}`
}

interface TeacherSettings {
  work_start: string; work_end: string
  break_start: string | null; break_end: string | null
  work_days: number[]
}

interface StudentSchedule {
  id: string; student_id: string; student_name: string
  day_of_week: number; start_time: string; duration_minutes: number
}

interface BlockedSlot {
  id: string; label: string; slot_type: 'recurring' | 'one_time'
  day_of_week: number | null; start_time: string | null
  end_time: string | null; blocked_date: string | null
}

interface PreviewLesson {
  key: string; studentId: string; studentName: string; scheduleId: string
  date: string; startTime: string; endTime: string; durationMinutes: number
  conflicts: string[]; selected: boolean; alreadyExists: boolean
}

interface PreviewDay {
  date: string; dayOfWeek: number; isWorkDay: boolean; isSkipped: boolean
  blockedFull: BlockedSlot[]; lessons: PreviewLesson[]
}

type Step = 'params' | 'preview' | 'done'

export default function GeneratePage() {
  const [step, setStep] = useState<Step>('params')
  const [periodType, setPeriodType] = useState<'week' | '2weeks' | 'month'>('week')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    const diff = (8 - d.getDay()) % 7 || 7
    d.setDate(d.getDate() + diff)
    return d.toISOString().split('T')[0]
  })
  const [loading, setLoading] = useState(false)
  const [previewDays, setPreviewDays] = useState<PreviewDay[]>([])
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [error, setError] = useState('')

  async function buildPreview() {
    setLoading(true); setError('')
    const [settingsRes, schedulesRes, blockedRes] = await Promise.all([
      supabase.from('teacher_settings').select('*').limit(1).single(),
      supabase.from('student_schedules').select('*, students(name)').eq('is_active', true),
      supabase.from('blocked_slots').select('*'),
    ])
    if (!settingsRes.data) {
      setError('Не найдены настройки преподавателя. Зайди в Настройки и сохрани режим работы.')
      setLoading(false); return
    }
    const settings = settingsRes.data as TeacherSettings
    const blockedSlots = (blockedRes.data || []) as BlockedSlot[]
    const studentSchedules: StudentSchedule[] = (schedulesRes.data || []).map((s: any) => ({
      id: s.id, student_id: s.student_id,
      student_name: s.students?.name || 'Неизвестный',
      day_of_week: s.day_of_week,
      start_time: s.start_time?.slice(0, 5) || '09:00',
      duration_minutes: s.duration_minutes,
    }))

    const start = new Date(startDate + 'T00:00:00')
    const daysCount = periodType === 'week' ? 7 : periodType === '2weeks' ? 14 : 31
    const dates: string[] = []
    for (let i = 0; i < daysCount; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i)
      if (periodType === 'month' && d.getMonth() !== start.getMonth()) break
      dates.push(d.toISOString().split('T')[0])
    }

    const endDateStr = dates[dates.length - 1]
    const { data: existingLessons } = await supabase.from('lessons')
      .select('student_id, scheduled_at, duration_minutes')
      .gte('scheduled_at', startDate + 'T00:00:00')
      .lte('scheduled_at', endDateStr + 'T23:59:59')
      .in('status', ['scheduled', 'completed'])

    const days: PreviewDay[] = dates.map(dateStr => {
      const d = new Date(dateStr + 'T00:00:00')
      const dayOfWeek = jsDayToOur(d.getDay())
      const isWorkDay = settings.work_days.includes(dayOfWeek)
      const blockedFull = blockedSlots.filter(b => b.slot_type === 'one_time' && b.blocked_date === dateStr && !b.start_time)
      const lessons: PreviewLesson[] = []

      if (isWorkDay) {
        const daySchedules = studentSchedules.filter(s => s.day_of_week === dayOfWeek)
        for (const sch of daySchedules) {
          const endTime = addMinutes(sch.start_time, sch.duration_minutes)
          const conflicts: string[] = []

          if (timeToMinutes(sch.start_time) < timeToMinutes(settings.work_start.slice(0, 5)))
            conflicts.push(`До начала рабочего дня (с ${settings.work_start.slice(0, 5)})`)
          if (timeToMinutes(endTime) > timeToMinutes(settings.work_end.slice(0, 5)))
            conflicts.push(`После окончания рабочего дня (до ${settings.work_end.slice(0, 5)})`)

          if (settings.break_start && settings.break_end) {
            const bs = settings.break_start.slice(0, 5), be = settings.break_end.slice(0, 5)
            if (overlaps(sch.start_time, endTime, bs, be))
              conflicts.push(`Пересекается с перерывом (${bs}–${be})`)
          }

          for (const block of blockedSlots.filter(b => b.slot_type === 'recurring' && b.day_of_week === dayOfWeek && b.start_time)) {
            if (overlaps(sch.start_time, endTime, block.start_time!.slice(0, 5), block.end_time!.slice(0, 5)))
              conflicts.push(`Пересекается с «${block.label}»`)
          }
          for (const block of blockedSlots.filter(b => b.slot_type === 'one_time' && b.blocked_date === dateStr && b.start_time)) {
            if (overlaps(sch.start_time, endTime, block.start_time!.slice(0, 5), block.end_time!.slice(0, 5)))
              conflicts.push(`Пересекается с «${block.label}»`)
          }
          if (blockedFull.length > 0)
            conflicts.push(`День заблокирован: ${blockedFull.map(b => b.label).join(', ')}`)

          const alreadyExists = (existingLessons || []).some((l: any) => {
            if (l.student_id !== sch.student_id) return false
            const lDate = l.scheduled_at.split('T')[0]
            const lTime = l.scheduled_at.split('T')[1].slice(0, 5)
            return lDate === dateStr && overlaps(sch.start_time, endTime, lTime, addMinutes(lTime, l.duration_minutes))
          })

          lessons.push({
            key: `${dateStr}-${sch.student_id}-${sch.start_time}`,
            studentId: sch.student_id, studentName: sch.student_name,
            scheduleId: sch.id, date: dateStr, startTime: sch.start_time, endTime,
            durationMinutes: sch.duration_minutes, conflicts,
            selected: !alreadyExists && conflicts.length === 0,
            alreadyExists,
          })
        }
        lessons.sort((a, b) => a.startTime.localeCompare(b.startTime))
      }
      return { date: dateStr, dayOfWeek, isWorkDay, isSkipped: false, blockedFull, lessons }
    })

    setPreviewDays(days); setStep('preview'); setLoading(false)
  }

  function toggleLesson(key: string) {
    setPreviewDays(days => days.map(day => ({
      ...day,
      lessons: day.lessons.map(l => l.key === key ? { ...l, selected: !l.selected } : l)
    })))
  }

  function toggleDay(date: string) {
    setPreviewDays(days => days.map(day => {
      if (day.date !== date) return day
      const newSkipped = !day.isSkipped
      return { ...day, isSkipped: newSkipped, lessons: day.lessons.map(l => ({ ...l, selected: !newSkipped && l.conflicts.length === 0 && !l.alreadyExists })) }
    }))
  }

  function toggleAllInDay(date: string, selected: boolean) {
    setPreviewDays(days => days.map(day =>
      day.date !== date ? day : { ...day, lessons: day.lessons.map(l => l.alreadyExists ? l : { ...l, selected }) }
    ))
  }

  async function saveSchedule() {
    setSaving(true); setError('')
    const toCreate = previewDays.flatMap(d => d.lessons).filter(l => l.selected && !l.alreadyExists)
    if (toCreate.length === 0) { setError('Нет занятий для создания'); setSaving(false); return }
    const { error: err } = await supabase.from('lessons').insert(
      toCreate.map(l => ({
        student_id: l.studentId,
        scheduled_at: `${l.date}T${l.startTime}:00`,
        duration_minutes: l.durationMinutes,
        status: 'scheduled', is_trial: false, google_event_id: null, notes: null,
      }))
    )
    if (err) { setError(err.message); setSaving(false); return }
    setSavedCount(toCreate.length); setStep('done'); setSaving(false)
  }

  const selectedCount = previewDays.flatMap(d => d.lessons).filter(l => l.selected && !l.alreadyExists).length
  const conflictCount = previewDays.flatMap(d => d.lessons).filter(l => l.conflicts.length > 0).length
  const existingCount = previewDays.flatMap(d => d.lessons).filter(l => l.alreadyExists).length

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/schedule" className="text-gray-400 hover:text-gray-600 text-sm">← Расписание</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold text-gray-900">Генерация расписания</h1>
      </div>

      {step === 'params' && (
        <div className="card space-y-5">
          <h2 className="font-semibold text-gray-700">Параметры генерации</h2>
          <div>
            <label className="label">Период</label>
            <div className="flex gap-2">
              {([{ value: 'week', label: '1 неделя' }, { value: '2weeks', label: '2 недели' }, { value: 'month', label: '1 месяц' }] as const).map(({ value, label }) => (
                <button key={value} onClick={() => setPeriodType(value)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${periodType === value ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-300 hover:border-sky-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Дата начала</label>
            <input className="input max-w-xs" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="bg-sky-50 rounded-lg p-3 text-sm text-sky-700">
            Расписание строится по регулярным слотам учеников. Убедись что в карточках учеников заданы дни и время, а в{' '}
            <Link href="/settings" className="font-semibold underline">Настройках</Link> указан режим работы.
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button onClick={buildPreview} disabled={loading} className="btn-primary">
            {loading ? 'Формирование...' : 'Сформировать предпросмотр →'}
          </button>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="card bg-sky-50 border-sky-100">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex gap-4 text-sm">
                <span className="text-sky-700 font-medium">✓ Будет создано: <strong>{selectedCount}</strong></span>
                {existingCount > 0 && <span className="text-gray-500">Уже есть: {existingCount}</span>}
                {conflictCount > 0 && <span className="text-amber-600">⚠ Конфликты: {conflictCount}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('params')} className="btn-secondary text-sm">← Изменить</button>
                <button onClick={saveSchedule} disabled={saving || selectedCount === 0} className="btn-primary text-sm">
                  {saving ? 'Создание...' : `Создать ${selectedCount} занятий`}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          {previewDays.map((day) => {
            const hasLessons = day.lessons.length > 0
            const allSelected = day.lessons.filter(l => !l.alreadyExists).every(l => l.selected)
            if (!day.isWorkDay && !hasLessons) return (
              <div key={day.date} className="flex items-center gap-3 py-1">
                <span className="text-xs text-gray-300 w-44">{formatRuDate(day.date)}</span>
                <span className="text-xs text-gray-300">— нерабочий день</span>
              </div>
            )
            return (
              <div key={day.date} className={`card space-y-2 ${day.isSkipped ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{formatRuDate(day.date)}</span>
                    {day.blockedFull.length > 0 && <span className="badge bg-red-100 text-red-600">🚫 {day.blockedFull.map(b => b.label).join(', ')}</span>}
                    {!day.isWorkDay && <span className="badge bg-gray-100 text-gray-400">нерабочий</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {hasLessons && !day.isSkipped && (
                      <button onClick={() => toggleAllInDay(day.date, !allSelected)} className="text-xs text-gray-400 hover:text-sky-600">
                        {allSelected ? 'Снять все' : 'Выбрать все'}
                      </button>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                      <input type="checkbox" checked={!day.isSkipped} onChange={() => toggleDay(day.date)} />
                      Рабочий день
                    </label>
                  </div>
                </div>
                {!day.isSkipped && day.lessons.length > 0 && (
                  <div className="space-y-1.5">
                    {day.lessons.map((lesson) => (
                      <div key={lesson.key}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 ${lesson.alreadyExists ? 'bg-gray-50 opacity-60' : lesson.conflicts.length > 0 ? 'bg-amber-50' : lesson.selected ? 'bg-green-50' : 'bg-gray-50'}`}>
                        <input type="checkbox" checked={lesson.selected} disabled={lesson.alreadyExists} onChange={() => toggleLesson(lesson.key)} className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">{lesson.startTime}–{lesson.endTime}</span>
                            <span className="text-sm text-gray-700">{lesson.studentName}</span>
                            <span className="text-xs text-gray-400">{lesson.durationMinutes} мин</span>
                            {lesson.alreadyExists && <span className="badge bg-gray-100 text-gray-500">уже есть</span>}
                          </div>
                          {lesson.conflicts.map((c, i) => <p key={i} className="text-xs text-amber-600 mt-0.5">⚠ {c}</p>)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!day.isSkipped && day.lessons.length === 0 && <p className="text-xs text-gray-400 ml-1">Занятий не запланировано</p>}
              </div>
            )
          })}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep('params')} className="btn-secondary">← Изменить параметры</button>
            <button onClick={saveSchedule} disabled={saving || selectedCount === 0} className="btn-primary">
              {saving ? 'Создание...' : `Создать ${selectedCount} занятий`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="card text-center py-12 space-y-4">
          <div className="text-5xl">✅</div>
          <h2 className="text-xl font-bold text-gray-900">Расписание создано!</h2>
          <p className="text-gray-500">Добавлено занятий: <strong>{savedCount}</strong></p>
          <div className="flex gap-3 justify-center">
            <Link href="/schedule" className="btn-primary">Перейти в расписание</Link>
            <button onClick={() => { setStep('params'); setPreviewDays([]) }} className="btn-secondary">Сгенерировать ещё</button>
          </div>
        </div>
      )}
    </div>
  )
}

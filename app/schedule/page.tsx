'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Lesson, Student } from '@/lib/types'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const ROW_HEIGHT = 64 // px per hour

function jsDayToOur(jsDay: number): number { return (jsDay + 6) % 7 }

function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

interface TeacherSettings {
  work_start: string; work_end: string
  break_start: string | null; break_end: string | null
  work_days: number[]
}

interface BlockedSlot {
  id: string; label: string; slot_type: 'recurring' | 'one_time'
  day_of_week: number | null; start_time: string | null
  end_time: string | null; blocked_date: string | null
}

interface DayBlock {
  label: string
  startTime: string // HH:MM
  endTime: string   // HH:MM
  type: 'break' | 'recurring' | 'one_time'
}

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [lessons, setLessons] = useState<(Lesson & { student: Student })[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [settings, setSettings] = useState<TeacherSettings | null>(null)
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number } | null>(null)

  useEffect(() => { loadWeek() }, [weekStart])

  async function loadWeek() {
    setLoading(true)
    const from = weekStart.toISOString()
    const to = addDays(weekStart, 7).toISOString()

    const [lRes, sRes, settingsRes, blockedRes] = await Promise.all([
      supabase.from('lessons').select('*, student:students(*)').gte('scheduled_at', from).lt('scheduled_at', to).order('scheduled_at') as any,
      supabase.from('students').select('*').eq('is_active', true).order('name') as any,
      supabase.from('teacher_settings').select('*').limit(1).single() as any,
      supabase.from('blocked_slots').select('*') as any,
    ])

    setLessons((lRes.data || []) as any)
    setStudents(sRes.data || [])
    if (settingsRes.data) setSettings(settingsRes.data as TeacherSettings)
    setBlockedSlots((blockedRes.data || []) as BlockedSlot[])
    setLoading(false)
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // Hours range from settings or default 7-21
  const firstHour = settings ? Math.floor(timeToMinutes(settings.work_start) / 60) : 7
  const lastHour  = settings ? Math.ceil(timeToMinutes(settings.work_end) / 60) : 21
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i)
  const totalHeight = hours.length * ROW_HEIGHT

  // Convert time to px offset from top of grid
  function timeToPx(timeStr: string): number {
    return ((timeToMinutes(timeStr) - firstHour * 60) / 60) * ROW_HEIGHT
  }

  function durationToPx(minutes: number): number {
    return (minutes / 60) * ROW_HEIGHT
  }

  function isWorkDay(day: Date): boolean {
    if (!settings) return true
    return settings.work_days.includes(jsDayToOur(day.getDay()))
  }

  function isFullDayBlocked(day: Date): BlockedSlot | null {
    const dateStr = format(day, 'yyyy-MM-dd')
    return blockedSlots.find(b => b.slot_type === 'one_time' && b.blocked_date === dateStr && !b.start_time) || null
  }

  function getDayBlocks(day: Date): DayBlock[] {
    const result: DayBlock[] = []
    const dateStr = format(day, 'yyyy-MM-dd')
    const dayOfWeek = jsDayToOur(day.getDay())

    // Break
    if (settings?.break_start && settings?.break_end) {
      result.push({
        label: `Перерыв`,
        startTime: settings.break_start.slice(0, 5),
        endTime: settings.break_end.slice(0, 5),
        type: 'break',
      })
    }

    // Recurring blocks for this day of week
    for (const b of blockedSlots.filter(b => b.slot_type === 'recurring' && b.day_of_week === dayOfWeek && b.start_time)) {
      result.push({ label: b.label, startTime: b.start_time!.slice(0, 5), endTime: b.end_time!.slice(0, 5), type: 'recurring' })
    }

    // One-time blocks with specific time
    for (const b of blockedSlots.filter(b => b.slot_type === 'one_time' && b.blocked_date === dateStr && b.start_time)) {
      result.push({ label: b.label, startTime: b.start_time!.slice(0, 5), endTime: b.end_time!.slice(0, 5), type: 'one_time' })
    }

    return result
  }

  function lessonsForDay(day: Date) {
    return lessons.filter((l) => isSameDay(parseISO(l.scheduled_at), day))
  }

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>, day: Date) {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const hour = firstHour + Math.floor(y / ROW_HEIGHT)
    setSelectedSlot({ date: day, hour })
    setShowAddModal(true)
  }

  const today = new Date()

  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 5rem)' }}>
      {/* Навигация */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Расписание</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="btn-secondary px-3">←</button>
          <span className="text-sm font-medium text-gray-700 min-w-[12rem] text-center">
            {format(weekStart, 'd MMM', { locale: ru })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: ru })}
          </span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="btn-secondary px-3">→</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="btn-secondary text-sm">Сегодня</button>
          <Link href="/schedule/generate" className="btn-secondary text-sm">🗓 Сгенерировать</Link>
          <button onClick={() => { setSelectedSlot(null); setShowAddModal(true) }} className="btn-primary">+ Занятие</button>
        </div>
      </div>

      {/* Сетка */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Заголовок дней */}
        <div className="grid flex-shrink-0 border-b border-gray-100" style={{ gridTemplateColumns: '3.5rem repeat(7, 1fr)' }}>
          <div className="py-2" />
          {weekDays.map((day) => {
            const fullBlock = isFullDayBlocked(day)
            const workDay = isWorkDay(day)
            return (
              <div
                key={day.toISOString()}
                className={`py-2 text-center text-sm font-medium border-l border-gray-100 ${
                  isSameDay(day, today) ? 'bg-sky-50'
                  : fullBlock ? 'bg-red-50'
                  : !workDay ? 'bg-gray-50'
                  : ''
                }`}
              >
                <div className="text-xs text-gray-400">{format(day, 'EEE', { locale: ru })}</div>
                <div className={`text-lg font-bold ${isSameDay(day, today) ? 'text-sky-600' : 'text-gray-800'}`}>
                  {format(day, 'd')}
                </div>
                {fullBlock && <div className="text-xs text-red-500 font-normal truncate px-1">{fullBlock.label}</div>}
                {!fullBlock && !workDay && <div className="text-xs text-gray-400 font-normal">выходной</div>}
              </div>
            )
          })}
        </div>

        {/* Временная сетка с прокруткой */}
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Загрузка...</div>
        ) : (
          <div className="overflow-y-auto flex-1">
            <div className="grid" style={{ gridTemplateColumns: '3.5rem repeat(7, 1fr)', height: totalHeight }}>
              {/* Колонка времени */}
              <div className="relative border-r border-gray-100">
                {hours.map((hour, i) => (
                  <div key={hour} className="absolute w-full border-b border-gray-50" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}>
                    <span className="text-xs text-gray-400 px-1.5 pt-1 block">{hour}:00</span>
                  </div>
                ))}
              </div>

              {/* Колонки дней */}
              {weekDays.map((day) => {
                const fullBlock = isFullDayBlocked(day)
                const workDay = isWorkDay(day)
                const dayBlocks = (!fullBlock && workDay) ? getDayBlocks(day) : []
                const dayLessons = lessonsForDay(day)

                return (
                  <div
                    key={day.toISOString()}
                    className={`relative border-l border-gray-100 cursor-pointer ${
                      fullBlock ? 'bg-red-50/40' : !workDay ? 'bg-gray-50/70' : 'hover:bg-sky-50/20'
                    }`}
                    style={{ height: totalHeight }}
                    onClick={(e) => { if (!fullBlock && workDay) handleColumnClick(e, day) }}
                  >
                    {/* Горизонтальные линии часов */}
                    {hours.map((_, i) => (
                      <div key={i} className="absolute w-full border-b border-gray-50" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }} />
                    ))}

                    {/* Блокировки и личное время */}
                    {dayBlocks.map((block, i) => {
                      const top = timeToPx(block.startTime)
                      const height = Math.max(16, timeToPx(block.endTime) - top)
                      if (top < 0 || top >= totalHeight) return null
                      return (
                        <div
                          key={i}
                          className={`absolute left-0.5 right-0.5 rounded px-1.5 py-1 overflow-hidden z-10 ${
                            block.type === 'break'
                              ? 'bg-yellow-100 border border-yellow-200'
                              : 'bg-orange-100 border border-orange-200'
                          }`}
                          style={{ top, height }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className={`text-xs font-medium truncate ${block.type === 'break' ? 'text-yellow-700' : 'text-orange-700'}`}>
                            {block.label}
                          </div>
                          <div className={`text-xs truncate ${block.type === 'break' ? 'text-yellow-600' : 'text-orange-600'}`}>
                            {block.startTime}–{block.endTime}
                          </div>
                        </div>
                      )
                    })}

                    {/* Занятия */}
                    {dayLessons.map((lesson) => {
                      const d = parseISO(lesson.scheduled_at)
                      const startStr = formatHHMM(d)
                      const top = timeToPx(startStr)
                      const height = Math.max(20, durationToPx(lesson.duration_minutes))
                      if (top < 0 || top >= totalHeight) return null
                      return (
                        <LessonBlock
                          key={lesson.id}
                          lesson={lesson}
                          top={top}
                          height={height}
                          startStr={startStr}
                          onRefresh={loadWeek}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Легенда */}
      <div className="flex items-center gap-4 text-xs text-gray-400 flex-shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-sky-100 border border-sky-300 inline-block" /> Занятие</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-200 inline-block" /> Личное время</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200 inline-block" /> Перерыв</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50 border border-gray-200 inline-block" /> Выходной</span>
      </div>

      {showAddModal && (
        <AddLessonModal
          students={students}
          initialSlot={selectedSlot}
          onClose={() => { setShowAddModal(false); setSelectedSlot(null) }}
          onSaved={() => { setShowAddModal(false); setSelectedSlot(null); loadWeek() }}
        />
      )}
    </div>
  )
}

function LessonBlock({
  lesson, top, height, startStr, onRefresh
}: {
  lesson: Lesson & { student: Student }
  top: number; height: number; startStr: string
  onRefresh: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const router = useRouter()

  async function update(status: string) {
    await (supabase.from('lessons') as any).update({ status }).eq('id', lesson.id)
    setMenuOpen(false)
    onRefresh()
  }

  const colorMap: Record<string, string> = {
    scheduled: 'bg-sky-100 border-sky-300 text-sky-900',
    completed: 'bg-green-100 border-green-300 text-green-900',
    cancelled: 'bg-red-100 border-red-200 text-red-700 opacity-60',
    rescheduled: 'bg-yellow-100 border-yellow-300 text-yellow-900',
  }

  return (
    <div
      className={`absolute left-0.5 right-0.5 rounded border px-1.5 py-1 z-20 ${colorMap[lesson.status] || 'bg-gray-100'}`}
      style={{ top, height }}
      onClick={(e) => { e.stopPropagation(); router.push(`/students/${lesson.student_id}`) }}
    >
      {/* Кнопка меню статуса */}
      <button
        className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded opacity-40 hover:opacity-100 hover:bg-black/10 text-current z-30"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
        title="Изменить статус"
      >
        ⋮
      </button>

      <div className="text-xs font-semibold truncate leading-tight pr-5">{lesson.student?.name}</div>
      {height >= 32 && (
        <div className="text-xs opacity-70 truncate">{startStr} · {lesson.duration_minutes}м</div>
      )}
      {height >= 48 && lesson.is_trial && <div className="text-xs opacity-60">Пробное</div>}

      {menuOpen && (
        <div className="absolute z-30 top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-40" onClick={(e) => e.stopPropagation()}>
          {[
            { status: 'scheduled',   label: '🕐 Запланировано', cls: 'text-gray-700' },
            { status: 'completed',   label: '✓ Проведено',      cls: 'text-green-700' },
            { status: 'cancelled',   label: '✕ Отменено',       cls: 'text-red-600' },
            { status: 'rescheduled', label: '↩ Перенесено',     cls: 'text-yellow-700' },
          ].map(({ status, label, cls }) => (
            <button
              key={status}
              onClick={() => update(status)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-1.5 ${cls} ${lesson.status === status ? 'font-semibold bg-gray-50' : ''}`}
            >
              {label}
              {lesson.status === status && <span className="ml-auto text-gray-400">✓</span>}
            </button>
          ))}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Закрыть</button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddLessonModal({
  students, initialSlot, onClose, onSaved
}: {
  students: Student[]
  initialSlot: { date: Date; hour: number } | null
  onClose: () => void
  onSaved: () => void
}) {
  const defaultDate = initialSlot ? format(initialSlot.date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  const defaultTime = initialSlot ? `${String(initialSlot.hour).padStart(2, '0')}:00` : '10:00'

  const [form, setForm] = useState({
    student_id: students[0]?.id || '',
    date: defaultDate,
    time: defaultTime,
    duration: '60',
    is_trial: false,
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const scheduled_at = new Date(`${form.date}T${form.time}`).toISOString()
    await supabase.from('lessons').insert({
      student_id: form.student_id,
      scheduled_at,
      duration_minutes: Number(form.duration),
      status: 'scheduled',
      is_trial: form.is_trial,
      notes: form.notes || null,
      google_event_id: null,
    } as any)
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold">Добавить занятие</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="label">Ученик</label>
            <select className="input" value={form.student_id} onChange={(e) => setForm(p => ({ ...p, student_id: e.target.value }))}>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Дата</label>
              <input className="input" type="date" required value={form.date} onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Время</label>
              <input className="input" type="time" required value={form.time} onChange={(e) => setForm(p => ({ ...p, time: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Продолжительность</label>
            <select className="input" value={form.duration} onChange={(e) => setForm(p => ({ ...p, duration: e.target.value }))}>
              <option value="30">30 мин</option>
              <option value="45">45 мин</option>
              <option value="60">60 мин</option>
              <option value="90">90 мин</option>
              <option value="120">120 мин</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_trial} onChange={(e) => setForm(p => ({ ...p, is_trial: e.target.checked }))} />
            Пробное занятие
          </label>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Сохранение...' : 'Добавить'}</button>
            <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
          </div>
        </form>
      </div>
    </div>
  )
}

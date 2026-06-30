'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Lesson, Student } from '@/lib/types'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const ROW_HEIGHT = 64

function jsDayToOur(jsDay: number): number { return (jsDay + 6) % 7 }
function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}
function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const BREAK_CANCEL_LABEL = '__break_cancel__'

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
  id: string | null; label: string
  startTime: string; endTime: string
  type: 'break' | 'recurring' | 'one_time'
}
interface ContextMenu {
  x: number; y: number; above: boolean
  content: React.ReactNode
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
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const router = useRouter()

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

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

  function openMenu(e: React.MouseEvent, content: React.ReactNode) {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const above = rect.bottom > window.innerHeight * 0.55
    setContextMenu({ x: rect.left, y: above ? rect.top : rect.bottom, above, content })
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const firstHour = settings ? Math.floor(timeToMinutes(settings.work_start) / 60) : 7
  const lastHour  = settings ? Math.ceil(timeToMinutes(settings.work_end) / 60) : 21
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i)
  const totalHeight = hours.length * ROW_HEIGHT

  function timeToPx(t: string): number { return ((timeToMinutes(t) - firstHour * 60) / 60) * ROW_HEIGHT }
  function durationToPx(m: number): number { return (m / 60) * ROW_HEIGHT }

  function isWorkDay(day: Date): boolean {
    return !settings || settings.work_days.includes(jsDayToOur(day.getDay()))
  }
  function isFullDayBlocked(day: Date): BlockedSlot | null {
    const dateStr = format(day, 'yyyy-MM-dd')
    return blockedSlots.find(b => b.slot_type === 'one_time' && b.blocked_date === dateStr && !b.start_time) || null
  }

  function getDayBlocks(day: Date): DayBlock[] {
    const result: DayBlock[] = []
    const dateStr = format(day, 'yyyy-MM-dd')
    const dayOfWeek = jsDayToOur(day.getDay())

    // Check if break is cancelled for this specific day
    const breakCancelled = blockedSlots.some(b =>
      b.slot_type === 'one_time' && b.blocked_date === dateStr && b.label === BREAK_CANCEL_LABEL
    )
    if (settings?.break_start && settings?.break_end && !breakCancelled) {
      result.push({ id: null, label: 'Перерыв', startTime: settings.break_start.slice(0, 5), endTime: settings.break_end.slice(0, 5), type: 'break' })
    }
    for (const b of blockedSlots.filter(b => b.slot_type === 'recurring' && b.day_of_week === dayOfWeek && b.start_time)) {
      result.push({ id: b.id, label: b.label, startTime: b.start_time!.slice(0, 5), endTime: b.end_time!.slice(0, 5), type: 'recurring' })
    }
    for (const b of blockedSlots.filter(b => b.slot_type === 'one_time' && b.blocked_date === dateStr && b.start_time && b.label !== BREAK_CANCEL_LABEL)) {
      result.push({ id: b.id, label: b.label, startTime: b.start_time!.slice(0, 5), endTime: b.end_time!.slice(0, 5), type: 'one_time' })
    }
    return result
  }

  async function deleteBlock(id: string) {
    await (supabase.from('blocked_slots') as any).delete().eq('id', id)
    setContextMenu(null); loadWeek()
  }

  async function cancelBreakForDay(day: Date) {
    if (!settings?.break_start || !settings?.break_end) return
    await (supabase.from('blocked_slots') as any).insert({
      label: BREAK_CANCEL_LABEL,
      slot_type: 'one_time',
      blocked_date: format(day, 'yyyy-MM-dd'),
    })
    setContextMenu(null); loadWeek()
  }

  async function updateLessonStatus(id: string, status: string) {
    await (supabase.from('lessons') as any).update({ status }).eq('id', id)
    setContextMenu(null); loadWeek()
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
              <div key={day.toISOString()} className={`py-2 text-center text-sm font-medium border-l border-gray-100 ${isSameDay(day, today) ? 'bg-sky-50' : fullBlock ? 'bg-red-50' : !workDay ? 'bg-gray-50' : ''}`}>
                <div className="text-xs text-gray-400">{format(day, 'EEE', { locale: ru })}</div>
                <div className={`text-lg font-bold ${isSameDay(day, today) ? 'text-sky-600' : 'text-gray-800'}`}>{format(day, 'd')}</div>
                {fullBlock && <div className="text-xs text-red-500 font-normal truncate px-1">{fullBlock.label}</div>}
                {!fullBlock && !workDay && <div className="text-xs text-gray-400 font-normal">выходной</div>}
              </div>
            )
          })}
        </div>

        {/* Скролл с сеткой */}
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
                const dayLessons = lessons.filter(l => isSameDay(parseISO(l.scheduled_at), day))

                return (
                  <div
                    key={day.toISOString()}
                    className={`relative border-l border-gray-100 ${fullBlock ? 'bg-red-50/40' : !workDay ? 'bg-gray-50/70' : 'cursor-pointer hover:bg-sky-50/20'}`}
                    style={{ height: totalHeight }}
                    onClick={(e) => { if (!fullBlock && workDay) handleColumnClick(e, day) }}
                  >
                    {hours.map((_, i) => (
                      <div key={i} className="absolute w-full border-b border-gray-50" style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }} />
                    ))}

                    {dayBlocks.map((block, i) => {
                      const top = timeToPx(block.startTime)
                      const height = Math.max(16, timeToPx(block.endTime) - top)
                      if (top < 0 || top >= totalHeight) return null
                      const isBreak = block.type === 'break'
                      return (
                        <div
                          key={i}
                          className={`absolute left-0.5 right-0.5 rounded px-1.5 py-1 z-10 select-none ${isBreak ? 'bg-yellow-100 border border-yellow-200' : 'bg-orange-100 border border-orange-200'}`}
                          style={{ top, height }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className={`absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded opacity-40 hover:opacity-100 hover:bg-black/10 z-20 text-sm ${isBreak ? 'text-yellow-800' : 'text-orange-800'}`}
                            onClick={(e) => {
                              openMenu(e, isBreak
                                ? <BreakMenu day={day} onCancelDay={() => cancelBreakForDay(day)} onSettings={() => { setContextMenu(null); router.push('/settings') }} onClose={() => setContextMenu(null)} />
                                : <BlockMenu block={block} onDelete={() => block.id && deleteBlock(block.id)} onClose={() => setContextMenu(null)} />
                              )
                            }}
                          >⋮</button>
                          <div className={`text-xs font-medium truncate pr-5 leading-tight ${isBreak ? 'text-yellow-700' : 'text-orange-700'}`}>{block.label}</div>
                          {height >= 32 && <div className={`text-xs truncate ${isBreak ? 'text-yellow-600' : 'text-orange-600'}`}>{block.startTime}–{block.endTime}</div>}
                        </div>
                      )
                    })}

                    {dayLessons.map((lesson) => {
                      const d = parseISO(lesson.scheduled_at)
                      const startStr = formatHHMM(d)
                      const top = timeToPx(startStr)
                      const height = Math.max(20, durationToPx(lesson.duration_minutes))
                      if (top < 0 || top >= totalHeight) return null
                      const colorMap: Record<string, string> = {
                        scheduled: 'bg-sky-100 border-sky-300 text-sky-900',
                        completed: 'bg-green-100 border-green-300 text-green-900',
                        cancelled: 'bg-red-100 border-red-200 text-red-700 opacity-60',
                        rescheduled: 'bg-yellow-100 border-yellow-300 text-yellow-900',
                      }
                      return (
                        <div
                          key={lesson.id}
                          className={`absolute left-0.5 right-0.5 rounded border px-1.5 py-1 z-20 select-none ${colorMap[lesson.status] || 'bg-gray-100'}`}
                          style={{ top, height }}
                          onClick={(e) => { e.stopPropagation(); router.push(`/students/${lesson.student_id}`) }}
                        >
                          <button
                            className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded opacity-40 hover:opacity-100 hover:bg-black/10 z-30 text-sm text-current"
                            onClick={(e) => openMenu(e, <LessonMenu lesson={lesson} onUpdate={(s) => updateLessonStatus(lesson.id, s)} onClose={() => setContextMenu(null)} />)}
                          >⋮</button>
                          <div className="text-xs font-semibold truncate leading-tight pr-5">{lesson.student?.name}</div>
                          {height >= 32 && <div className="text-xs opacity-70 truncate">{startStr} · {lesson.duration_minutes}м</div>}
                          {height >= 48 && lesson.is_trial && <div className="text-xs opacity-60">Пробное</div>}
                        </div>
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

      {/* Контекстное меню (fixed, вне scroll-контейнера) */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-48"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            ...(contextMenu.above
              ? { bottom: window.innerHeight - contextMenu.y + 4 }
              : { top: contextMenu.y + 4 }),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.content}
        </div>
      )}

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

function LessonMenu({ lesson, onUpdate, onClose }: { lesson: Lesson & { student: Student }; onUpdate: (s: string) => void; onClose: () => void }) {
  return <>
    {[
      { status: 'scheduled',   label: '🕐 Запланировано', cls: 'text-gray-700' },
      { status: 'completed',   label: '✓ Проведено',      cls: 'text-green-700' },
      { status: 'cancelled',   label: '✕ Отменено',       cls: 'text-red-600' },
      { status: 'rescheduled', label: '↩ Перенесено',     cls: 'text-yellow-700' },
    ].map(({ status, label, cls }) => (
      <button key={status} onClick={() => onUpdate(status)}
        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center ${cls} ${lesson.status === status ? 'font-semibold bg-gray-50' : ''}`}>
        {label}{lesson.status === status && <span className="ml-auto text-gray-300">✓</span>}
      </button>
    ))}
    <div className="border-t border-gray-100 mt-1 pt-1">
      <button onClick={onClose} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Закрыть</button>
    </div>
  </>
}

function BreakMenu({ day, onCancelDay, onSettings, onClose }: { day: Date; onCancelDay: () => void; onSettings: () => void; onClose: () => void }) {
  const dateLabel = format(day, 'd MMM', { locale: ru })
  return <>
    <button onClick={onCancelDay} className="w-full text-left px-3 py-1.5 text-xs text-orange-700 hover:bg-orange-50">
      ✕ Отменить {dateLabel}
    </button>
    <button onClick={onSettings} className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
      ⚙️ Изменить расписание перерывов
    </button>
    <div className="border-t border-gray-100 mt-1 pt-1">
      <button onClick={onClose} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Закрыть</button>
    </div>
  </>
}

function BlockMenu({ block, onDelete, onClose }: { block: DayBlock; onDelete: () => void; onClose: () => void }) {
  return <>
    <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 truncate font-medium">{block.label}</div>
    <button onClick={onDelete} className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
      ✕ Удалить{block.type === 'recurring' ? ' серию' : ''}
    </button>
    <div className="border-t border-gray-100 mt-1 pt-1">
      <button onClick={onClose} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Закрыть</button>
    </div>
  </>
}

function AddLessonModal({ students, initialSlot, onClose, onSaved }: {
  students: Student[]; initialSlot: { date: Date; hour: number } | null
  onClose: () => void; onSaved: () => void
}) {
  const defaultDate = initialSlot ? format(initialSlot.date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  const defaultTime = initialSlot ? `${String(initialSlot.hour).padStart(2, '0')}:00` : '10:00'
  const [form, setForm] = useState({ student_id: students[0]?.id || '', date: defaultDate, time: defaultTime, duration: '60', is_trial: false })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const scheduled_at = new Date(`${form.date}T${form.time}`).toISOString()
    await supabase.from('lessons').insert({ student_id: form.student_id, scheduled_at, duration_minutes: Number(form.duration), status: 'scheduled', is_trial: form.is_trial, notes: null, google_event_id: null } as any)
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
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Дата</label><input className="input" type="date" required value={form.date} onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div><label className="label">Время</label><input className="input" type="time" required value={form.time} onChange={(e) => setForm(p => ({ ...p, time: e.target.value }))} /></div>
          </div>
          <div>
            <label className="label">Продолжительность</label>
            <select className="input" value={form.duration} onChange={(e) => setForm(p => ({ ...p, duration: e.target.value }))}>
              <option value="30">30 мин</option><option value="45">45 мин</option><option value="60">60 мин</option><option value="90">90 мин</option><option value="120">120 мин</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_trial} onChange={(e) => setForm(p => ({ ...p, is_trial: e.target.checked }))} /> Пробное занятие
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

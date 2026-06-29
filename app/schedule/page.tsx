'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Lesson, Student } from '@/lib/types'
import { formatTime, formatMoney, lessonStatusLabel, lessonStatusColor } from '@/lib/utils'
import { format, addDays, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7) // 7:00 – 21:00

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [lessons, setLessons] = useState<(Lesson & { student: Student })[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number } | null>(null)

  useEffect(() => { loadWeek() }, [weekStart])

  async function loadWeek() {
    setLoading(true)
    const from = weekStart.toISOString()
    const to = addDays(weekStart, 7).toISOString()

    const [lRes, sRes] = await Promise.all([
      supabase
        .from('lessons')
        .select('*, student:students(*)')
        .gte('scheduled_at', from)
        .lt('scheduled_at', to)
        .order('scheduled_at'),
      supabase.from('students').select('*').eq('is_active', true).order('name'),
    ])

    setLessons((lRes.data || []) as any)
    setStudents(sRes.data || [])
    setLoading(false)
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function lessonsForDay(day: Date) {
    return lessons.filter((l) => isSameDay(parseISO(l.scheduled_at), day))
  }

  function handleSlotClick(date: Date, hour: number) {
    setSelectedSlot({ date, hour })
    setShowAddModal(true)
  }

  const today = new Date()

  return (
    <div className="space-y-4">
      {/* Навигация по неделям */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Расписание</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="btn-secondary px-3">←</button>
          <span className="text-sm font-medium text-gray-700">
            {format(weekStart, 'd MMM', { locale: ru })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: ru })}
          </span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="btn-secondary px-3">→</button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="btn-secondary text-sm"
          >
            Сегодня
          </button>
          <Link href="/schedule/generate" className="btn-secondary text-sm">🗓 Сгенерировать</Link>
          <button onClick={() => { setSelectedSlot(null); setShowAddModal(true) }} className="btn-primary">+ Занятие</button>
        </div>
      </div>

      {/* Сетка недели */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-auto">
        {/* Заголовок дней */}
        <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '4rem repeat(7, 1fr)' }}>
          <div className="py-2" />
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={`py-2 text-center text-sm font-medium border-l border-gray-100 ${
                isSameDay(day, today) ? 'bg-sky-50 text-sky-700' : 'text-gray-600'
              }`}
            >
              <div className="text-xs text-gray-400">{format(day, 'EEE', { locale: ru })}</div>
              <div className={`text-lg font-bold ${isSameDay(day, today) ? 'text-sky-600' : 'text-gray-800'}`}>
                {format(day, 'd')}
              </div>
            </div>
          ))}
        </div>

        {/* Временная сетка */}
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Загрузка...</div>
        ) : (
          <div className="overflow-y-auto max-h-[600px]">
            {HOURS.map((hour) => (
              <div key={hour} className="grid border-b border-gray-50 last:border-0" style={{ gridTemplateColumns: '4rem repeat(7, 1fr)', minHeight: '4rem' }}>
                <div className="px-2 py-1 text-xs text-gray-400 pt-1">{hour}:00</div>
                {weekDays.map((day) => {
                  const dayLessons = lessonsForDay(day).filter((l) => {
                    const lessonHour = parseISO(l.scheduled_at).getHours()
                    return lessonHour === hour
                  })
                  return (
                    <div
                      key={day.toISOString()}
                      className="border-l border-gray-50 relative p-0.5 cursor-pointer hover:bg-gray-50 min-h-[4rem]"
                      onClick={() => handleSlotClick(day, hour)}
                    >
                      {dayLessons.map((lesson) => (
                        <LessonBlock key={lesson.id} lesson={lesson} onRefresh={loadWeek} />
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
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

function LessonBlock({ lesson, onRefresh }: { lesson: Lesson & { student: Student }; onRefresh: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)

  async function update(status: string) {
    await supabase.from('lessons').update({ status }).eq('id', lesson.id)
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
      className={`text-xs rounded p-1.5 border mb-0.5 cursor-pointer relative ${colorMap[lesson.status] || 'bg-gray-100'}`}
      onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
    >
      <div className="font-medium truncate">{lesson.student?.name}</div>
      <div className="text-xs opacity-70">{formatTime(lesson.scheduled_at)} · {lesson.duration_minutes}м</div>
      {lesson.is_trial && <div className="text-xs opacity-70">Пробное</div>}

      {menuOpen && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-36" onClick={(e) => e.stopPropagation()}>
          {lesson.status === 'scheduled' && (
            <>
              <button onClick={() => update('completed')} className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">✓ Проведено</button>
              <button onClick={() => update('cancelled')} className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">✕ Отменить</button>
              <button onClick={() => update('rescheduled')} className="w-full text-left px-3 py-1.5 text-xs text-yellow-700 hover:bg-yellow-50">↩ Перенесено</button>
            </>
          )}
          {lesson.status !== 'scheduled' && (
            <button onClick={() => update('scheduled')} className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">↩ Вернуть</button>
          )}
          <button onClick={() => setMenuOpen(false)} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">Закрыть</button>
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
              <option value="45">45 мин</option>
              <option value="60">60 мин</option>
              <option value="90">90 мин</option>
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

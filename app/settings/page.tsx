'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

interface TeacherSettings {
  id: string
  work_start: string
  work_end: string
  break_start: string | null
  break_end: string | null
  work_days: number[]
}

interface BlockedSlot {
  id: string
  label: string
  slot_type: 'recurring' | 'one_time'
  day_of_week: number | null
  start_time: string | null
  end_time: string | null
  blocked_date: string | null
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<TeacherSettings | null>(null)
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'' | 'saving' | 'saved'>('')

  const [form, setForm] = useState({
    work_start: '09:00',
    work_end: '20:00',
    break_start: '12:00',
    break_end: '14:00',
    has_break: true,
    work_days: [0, 1, 2, 3, 4] as number[],
  })

  const [showBlockForm, setShowBlockForm] = useState(false)
  const [blockForm, setBlockForm] = useState({
    label: '',
    slot_type: 'recurring' as 'recurring' | 'one_time',
    day_of_week: '0',
    start_time: '10:00',
    end_time: '11:00',
    blocked_date: '',
    all_day: false,
  })
  const [blockSaving, setBlockSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [settingsRes, slotsRes] = await Promise.all([
      supabase.from('teacher_settings').select('*').limit(1).single(),
      supabase.from('blocked_slots').select('*').order('slot_type').order('day_of_week').order('blocked_date'),
    ])
    if (settingsRes.data) {
      const s = settingsRes.data as TeacherSettings
      setSettings(s)
      setForm({
        work_start: s.work_start?.slice(0, 5) || '09:00',
        work_end: s.work_end?.slice(0, 5) || '20:00',
        break_start: s.break_start?.slice(0, 5) || '12:00',
        break_end: s.break_end?.slice(0, 5) || '14:00',
        has_break: !!(s.break_start && s.break_end),
        work_days: s.work_days || [0, 1, 2, 3, 4],
      })
    }
    setBlockedSlots(slotsRes.data || [])
    setLoading(false)
  }

  function toggleWorkDay(day: number) {
    setForm(prev => ({
      ...prev,
      work_days: prev.work_days.includes(day)
        ? prev.work_days.filter(d => d !== day)
        : [...prev.work_days, day].sort(),
    }))
  }

  async function saveSettings() {
    if (!settings) return
    setSaveStatus('saving')
    await supabase.from('teacher_settings').update({
      work_start: form.work_start,
      work_end: form.work_end,
      break_start: form.has_break ? form.break_start : null,
      break_end: form.has_break ? form.break_end : null,
      work_days: form.work_days,
      updated_at: new Date().toISOString(),
    }).eq('id', settings.id)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus(''), 2000)
  }

  async function addBlockedSlot(e: React.FormEvent) {
    e.preventDefault()
    setBlockSaving(true)
    const payload: any = { label: blockForm.label, slot_type: blockForm.slot_type }
    if (blockForm.slot_type === 'recurring') {
      payload.day_of_week = Number(blockForm.day_of_week)
      payload.start_time = blockForm.start_time
      payload.end_time = blockForm.end_time
    } else {
      payload.blocked_date = blockForm.blocked_date
      if (!blockForm.all_day) {
        payload.start_time = blockForm.start_time
        payload.end_time = blockForm.end_time
      }
    }
    await supabase.from('blocked_slots').insert(payload)
    setBlockSaving(false)
    setShowBlockForm(false)
    setBlockForm({ label: '', slot_type: 'recurring', day_of_week: '0', start_time: '10:00', end_time: '11:00', blocked_date: '', all_day: false })
    loadData()
  }

  async function deleteBlockedSlot(id: string) {
    await supabase.from('blocked_slots').delete().eq('id', id)
    loadData()
  }

  const recurringSlots = blockedSlots.filter(s => s.slot_type === 'recurring')
  const oneTimeSlots = blockedSlots.filter(s => s.slot_type === 'one_time')

  if (loading) return <div className="text-gray-400 text-sm">Загрузка...</div>

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Настройки</h1>

      <div className="card space-y-5">
        <h2 className="font-semibold text-gray-800">Режим работы</h2>

        <div>
          <label className="label">Рабочие дни</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((day, i) => (
              <button key={i} type="button" onClick={() => toggleWorkDay(i)}
                className={`w-10 h-10 rounded-lg text-sm font-medium border transition-colors ${
                  form.work_days.includes(i)
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white text-gray-500 border-gray-300 hover:border-sky-300'
                }`}>
                {day}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Начало рабочего дня</label>
            <input className="input" type="time" value={form.work_start} onChange={(e) => setForm(p => ({ ...p, work_start: e.target.value }))} />
          </div>
          <div>
            <label className="label">Конец рабочего дня</label>
            <input className="input" type="time" value={form.work_end} onChange={(e) => setForm(p => ({ ...p, work_end: e.target.value }))} />
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.has_break} onChange={(e) => setForm(p => ({ ...p, has_break: e.target.checked }))} />
            <span className="text-sm font-medium text-gray-700">Обеденный перерыв</span>
          </label>
          {form.has_break && (
            <div className="grid grid-cols-2 gap-4 ml-6">
              <div>
                <label className="label">Начало перерыва</label>
                <input className="input" type="time" value={form.break_start} onChange={(e) => setForm(p => ({ ...p, break_start: e.target.value }))} />
              </div>
              <div>
                <label className="label">Конец перерыва</label>
                <input className="input" type="time" value={form.break_end} onChange={(e) => setForm(p => ({ ...p, break_end: e.target.value }))} />
              </div>
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
          <span className="font-medium">Рабочее время: </span>
          {form.work_days.map(d => DAYS[d]).join(', ')} · {form.work_start}–{form.work_end}
          {form.has_break && ` (перерыв ${form.break_start}–${form.break_end})`}
        </div>

        <button onClick={saveSettings} disabled={saveStatus === 'saving'} className="btn-primary">
          {saveStatus === 'saved' ? '✓ Сохранено' : saveStatus === 'saving' ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Личное время</h2>
            <p className="text-xs text-gray-400 mt-0.5">Время, на которое нельзя ставить занятия</p>
          </div>
          <button onClick={() => setShowBlockForm(!showBlockForm)} className="btn-secondary text-sm">+ Добавить блокировку</button>
        </div>

        {showBlockForm && (
          <form onSubmit={addBlockedSlot} className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Название</label>
                <input className="input" required value={blockForm.label} onChange={(e) => setBlockForm(p => ({ ...p, label: e.target.value }))} placeholder="Тренировка, обед..." />
              </div>
              <div>
                <label className="label">Тип</label>
                <select className="input" value={blockForm.slot_type} onChange={(e) => setBlockForm(p => ({ ...p, slot_type: e.target.value as any }))}>
                  <option value="recurring">Регулярная (каждую неделю)</option>
                  <option value="one_time">Разовая (конкретная дата)</option>
                </select>
              </div>
            </div>

            {blockForm.slot_type === 'recurring' ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">День недели</label>
                  <select className="input" value={blockForm.day_of_week} onChange={(e) => setBlockForm(p => ({ ...p, day_of_week: e.target.value }))}>
                    {DAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">С</label>
                  <input className="input" type="time" value={blockForm.start_time} onChange={(e) => setBlockForm(p => ({ ...p, start_time: e.target.value }))} />
                </div>
                <div>
                  <label className="label">До</label>
                  <input className="input" type="time" value={blockForm.end_time} onChange={(e) => setBlockForm(p => ({ ...p, end_time: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="label">Дата</label>
                  <input className="input" type="date" required={blockForm.slot_type === 'one_time'} value={blockForm.blocked_date} onChange={(e) => setBlockForm(p => ({ ...p, blocked_date: e.target.value }))} />
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={blockForm.all_day} onChange={(e) => setBlockForm(p => ({ ...p, all_day: e.target.checked }))} />
                  Весь день (выходной, праздник)
                </label>
                {!blockForm.all_day && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">С</label>
                      <input className="input" type="time" value={blockForm.start_time} onChange={(e) => setBlockForm(p => ({ ...p, start_time: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label">До</label>
                      <input className="input" type="time" value={blockForm.end_time} onChange={(e) => setBlockForm(p => ({ ...p, end_time: e.target.value }))} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={blockSaving} className="btn-primary text-sm">{blockSaving ? 'Сохранение...' : 'Добавить'}</button>
              <button type="button" onClick={() => setShowBlockForm(false)} className="btn-secondary text-sm">Отмена</button>
            </div>
          </form>
        )}

        {recurringSlots.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Регулярные (каждую неделю)</p>
            {recurringSlots.map((slot) => (
              <div key={slot.id} className="flex items-center justify-between bg-orange-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-orange-700 w-6 text-center">{DAYS[slot.day_of_week!]}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{slot.label}</p>
                    <p className="text-xs text-gray-500">{slot.start_time?.slice(0, 5)}–{slot.end_time?.slice(0, 5)}</p>
                  </div>
                </div>
                <button onClick={() => deleteBlockedSlot(slot.id)} className="text-gray-300 hover:text-red-500 transition-colors text-lg px-1">✕</button>
              </div>
            ))}
          </div>
        )}

        {oneTimeSlots.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Разовые</p>
            {oneTimeSlots.map((slot) => (
              <div key={slot.id} className="flex items-center justify-between bg-red-50 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{slot.label}</p>
                  <p className="text-xs text-gray-500">
                    {slot.blocked_date}{slot.start_time ? ` · ${slot.start_time.slice(0, 5)}–${slot.end_time?.slice(0, 5)}` : ' · весь день'}
                  </p>
                </div>
                <button onClick={() => deleteBlockedSlot(slot.id)} className="text-gray-300 hover:text-red-500 transition-colors text-lg px-1">✕</button>
              </div>
            ))}
          </div>
        )}

        {blockedSlots.length === 0 && !showBlockForm && (
          <p className="text-sm text-gray-400 py-2">Блокировки не заданы</p>
        )}
      </div>
    </div>
  )
}

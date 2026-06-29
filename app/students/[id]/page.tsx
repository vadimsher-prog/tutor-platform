'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Student, Lesson, Payment, Package, MonthlySubscription } from '@/lib/types'
import { formatDate, formatDateTime, formatMoney, tariffLabel, lessonStatusLabel, lessonStatusColor } from '@/lib/utils'

type Tab = 'lessons' | 'payments' | 'packages' | 'schedule' | 'edit'

const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

interface StudentSchedule {
  id: string; student_id: string; day_of_week: number
  start_time: string; duration_minutes: number; is_active: boolean
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [student, setStudent] = useState<Student | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [packages, setPackages] = useState<Package[]>([])
  const [subscriptions, setSubscriptions] = useState<MonthlySubscription[]>([])
  const [schedules, setSchedules] = useState<StudentSchedule[]>([])
  const [tab, setTab] = useState<Tab>('lessons')
  const [loading, setLoading] = useState(true)
  const [showAddLesson, setShowAddLesson] = useState(false)
  const [showAddPayment, setShowAddPayment] = useState(false)

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    const [sRes, lRes, pRes, pkgRes, subRes, schRes] = await Promise.all([
      supabase.from('students').select('*').eq('id', id).single(),
      supabase.from('lessons').select('*').eq('student_id', id).order('scheduled_at', { ascending: false }),
      supabase.from('payments').select('*').eq('student_id', id).order('payment_date', { ascending: false }),
      supabase.from('packages').select('*').eq('student_id', id).order('created_at', { ascending: false }),
      supabase.from('monthly_subscriptions').select('*').eq('student_id', id).order('month', { ascending: false }),
      supabase.from('student_schedules').select('*').eq('student_id', id).eq('is_active', true).order('day_of_week').order('start_time'),
    ])
    setStudent(sRes.data)
    setLessons(lRes.data || [])
    setPayments(pRes.data || [])
    setPackages(pkgRes.data || [])
    setSubscriptions(subRes.data || [])
    setSchedules(schRes.data || [])
    setLoading(false)
  }

  async function markLessonCompleted(lessonId: string) {
    await supabase.from('lessons').update({ status: 'completed' }).eq('id', lessonId)
    loadData()
  }
  async function cancelLesson(lessonId: string) {
    await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lessonId)
    loadData()
  }
  async function archiveStudent() {
    if (!confirm('Перевести ученика в архив?')) return
    await supabase.from('students').update({ is_active: false }).eq('id', id)
    router.push('/students')
  }

  if (loading) return <div className="text-gray-400 text-sm">Загрузка...</div>
  if (!student) return <div className="text-red-500">Ученик не найден</div>

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
  const completedLessons = lessons.filter((l) => l.status === 'completed')
  const totalCost = completedLessons.reduce((s, l) => s + (l.duration_minutes / 60) * student.price_per_hour, 0)
  const balance = totalPaid - totalCost
  const schedulePreview = schedules.map(s => `${DAYS_SHORT[s.day_of_week]} ${s.start_time.slice(0, 5)}`).join(', ')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'lessons', label: `Занятия (${lessons.length})` },
    { key: 'payments', label: `Платежи (${payments.length})` },
    ...(student.tariff_type === 'package' ? [{ key: 'packages' as Tab, label: 'Пакеты' }] : []),
    ...(student.tariff_type === 'monthly' ? [{ key: 'packages' as Tab, label: 'Подписки' }] : []),
    { key: 'schedule', label: `Расписание${schedules.length > 0 ? ` (${schedules.length})` : ''}` },
    { key: 'edit', label: 'Настройки' },
  ]

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/students" className="text-gray-400 hover:text-gray-600 text-sm">← Ученики</Link>
      </div>

      <div className="card flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-sky-100 rounded-full flex items-center justify-center text-2xl font-bold text-sky-700">
            {student.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{student.name}</h1>
              {(student as any).language_level && <span className="badge bg-blue-100 text-blue-700">{(student as any).language_level}</span>}
              {(student as any).can_group && <span className="badge bg-amber-100 text-amber-700">👥 {(student as any).group_tag || 'Группа'}</span>}
              {!student.is_active && <span className="badge bg-gray-100 text-gray-500">Архив</span>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{tariffLabel(student.tariff_type)} · {formatMoney(student.price_per_hour)}/час</p>
            {schedulePreview && <p className="text-sm text-sky-600 mt-0.5">📅 {schedulePreview}</p>}
            {student.phone && <p className="text-sm text-gray-500">{student.phone}</p>}
            {student.telegram_username && <p className="text-sm text-gray-500">{student.telegram_username}</p>}
            {(student as any).contact_name && (
              <p className="text-sm text-gray-400 mt-1">
                Контакт: {(student as any).contact_name}
                {(student as any).contact_relation ? ` (${(student as any).contact_relation})` : ''}
                {(student as any).contact_phone ? ` · ${(student as any).contact_phone}` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          {student.tariff_type === 'per_lesson' && (
            <div>
              <p className={`text-xl font-bold ${balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatMoney(balance)}</p>
              <p className="text-xs text-gray-400">{balance >= 0 ? 'переплата' : 'долг'}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setShowAddLesson(true)} className="btn-primary">+ Занятие</button>
        <button onClick={() => setShowAddPayment(true)} className="btn-secondary">+ Платёж</button>
        {student.is_active && (
          <button onClick={archiveStudent} className="btn-secondary ml-auto text-red-600 border-red-200 hover:bg-red-50">В архив</button>
        )}
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'border-sky-600 text-sky-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'lessons' && (
        <div className="space-y-2">
          {lessons.length === 0 ? <p className="text-sm text-gray-400">Занятий ещё нет</p> : lessons.map((lesson) => (
            <div key={lesson.id} className="card flex items-center justify-between py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{formatDateTime(lesson.scheduled_at)}</span>
                  <span className={`badge ${lessonStatusColor(lesson.status)}`}>{lessonStatusLabel(lesson.status)}</span>
                  {lesson.is_trial && <span className="badge bg-purple-100 text-purple-700">Пробное</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{lesson.duration_minutes} мин</p>
              </div>
              {lesson.status === 'scheduled' && (
                <div className="flex gap-2">
                  <button onClick={() => markLessonCompleted(lesson.id)} className="btn-secondary text-xs py-1 px-2 text-green-700 border-green-200">✓ Проведено</button>
                  <button onClick={() => cancelLesson(lesson.id)} className="btn-secondary text-xs py-1 px-2 text-red-600 border-red-200">✕ Отменить</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'payments' && (
        <div className="space-y-2">
          {payments.length === 0 ? <p className="text-sm text-gray-400">Платежей ещё нет</p> : payments.map((payment) => (
            <div key={payment.id} className="card flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{formatDate(payment.payment_date)}</p>
                {payment.notes && <p className="text-xs text-gray-400 mt-0.5">{payment.notes}</p>}
              </div>
              <p className="text-base font-semibold text-green-600">{formatMoney(payment.amount)}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'packages' && student.tariff_type === 'package' && <PackagesTab packages={packages} studentId={id} onRefresh={loadData} />}
      {tab === 'packages' && student.tariff_type === 'monthly' && <SubscriptionsTab subscriptions={subscriptions} studentId={id} onRefresh={loadData} />}
      {tab === 'schedule' && <ScheduleTab studentId={id} schedules={schedules} onRefresh={loadData} />}
      {tab === 'edit' && <EditStudentForm student={student} onSaved={loadData} />}

      {showAddLesson && <AddLessonModal studentId={id} onClose={() => setShowAddLesson(false)} onSaved={() => { setShowAddLesson(false); loadData() }} />}
      {showAddPayment && <AddPaymentModal studentId={id} student={student} onClose={() => setShowAddPayment(false)} onSaved={() => { setShowAddPayment(false); loadData() }} />}
    </div>
  )
}

function ScheduleTab({ studentId, schedules, onRefresh }: { studentId: string; schedules: StudentSchedule[]; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ day_of_week: '0', start_time: '14:00', duration_minutes: '60' })
  const [saving, setSaving] = useState(false)

  async function addSlot(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('student_schedules').insert({
      student_id: studentId, day_of_week: Number(form.day_of_week),
      start_time: form.start_time, duration_minutes: Number(form.duration_minutes), is_active: true,
    })
    setSaving(false); setShowForm(false)
    setForm({ day_of_week: '0', start_time: '14:00', duration_minutes: '60' })
    onRefresh()
  }

  async function deleteSlot(slotId: string) {
    await supabase.from('student_schedules').update({ is_active: false }).eq('id', slotId)
    onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Регулярные дни и время занятий</p>
        <button onClick={() => setShowForm(!showForm)} className="btn-secondary text-sm">+ Добавить слот</button>
      </div>

      {showForm && (
        <form onSubmit={addSlot} className="card space-y-3 border-sky-200">
          <h3 className="text-sm font-semibold text-gray-700">Новый слот расписания</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">День недели</label>
              <select className="input" value={form.day_of_week} onChange={(e) => setForm(p => ({ ...p, day_of_week: e.target.value }))}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Время начала</label>
              <input className="input" type="time" value={form.start_time} onChange={(e) => setForm(p => ({ ...p, start_time: e.target.value }))} />
            </div>
            <div>
              <label className="label">Продолжительность</label>
              <select className="input" value={form.duration_minutes} onChange={(e) => setForm(p => ({ ...p, duration_minutes: e.target.value }))}>
                <option value="30">30 мин</option>
                <option value="45">45 мин</option>
                <option value="60">60 мин</option>
                <option value="90">90 мин</option>
                <option value="120">120 мин</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Сохранение...' : 'Добавить'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm">Отмена</button>
          </div>
        </form>
      )}

      {schedules.length === 0 ? (
        <div className="card py-8 text-center">
          <p className="text-gray-400 text-sm">Регулярное расписание не задано</p>
          <p className="text-xs text-gray-300 mt-1">Добавьте дни и время для генерации расписания</p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((slot) => (
            <div key={slot.id} className="card flex items-center justify-between py-3">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-sky-50 rounded-lg flex items-center justify-center text-sm font-bold text-sky-700">
                  {DAYS_SHORT[slot.day_of_week]}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{DAYS[slot.day_of_week]}</p>
                  <p className="text-xs text-gray-500">{slot.start_time.slice(0, 5)} · {slot.duration_minutes} мин</p>
                </div>
              </div>
              <button onClick={() => deleteSlot(slot.id)} className="text-gray-300 hover:text-red-500 transition-colors text-lg px-2" title="Удалить слот">✕</button>
            </div>
          ))}
        </div>
      )}

      {schedules.length > 0 && (
        <div className="bg-sky-50 rounded-lg p-3 text-sm text-sky-700">
          💡 Используй <Link href="/schedule/generate" className="font-semibold underline">Генерацию расписания</Link> чтобы создать занятия на нужный период
        </div>
      )}
    </div>
  )
}

function AddLessonModal({ studentId, onClose, onSaved }: { studentId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ date: '', time: '', duration: '60', is_trial: false, notes: '' })
  const [saving, setSaving] = useState(false)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const scheduled_at = new Date(`${form.date}T${form.time}`).toISOString()
    await supabase.from('lessons').insert({ student_id: studentId, scheduled_at, duration_minutes: Number(form.duration), status: 'scheduled', is_trial: form.is_trial, notes: form.notes || null, google_event_id: null })
    onSaved()
  }
  return (
    <Modal title="Добавить занятие" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Дата</label><input className="input" type="date" required value={form.date} onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))} /></div>
          <div><label className="label">Время</label><input className="input" type="time" required value={form.time} onChange={(e) => setForm(p => ({ ...p, time: e.target.value }))} /></div>
        </div>
        <div>
          <label className="label">Продолжительность</label>
          <select className="input" value={form.duration} onChange={(e) => setForm(p => ({ ...p, duration: e.target.value }))}>
            <option value="30">30 мин</option><option value="45">45 мин</option><option value="60">60 мин</option><option value="90">90 мин</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.is_trial} onChange={(e) => setForm(p => ({ ...p, is_trial: e.target.checked }))} />Пробное занятие</label>
        <div><label className="label">Заметки</label><input className="input" value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Сохранение...' : 'Добавить'}</button>
          <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        </div>
      </form>
    </Modal>
  )
}

function AddPaymentModal({ studentId, student, onClose, onSaved }: { studentId: string; student: Student; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ amount: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [saving, setSaving] = useState(false)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('payments').insert({ student_id: studentId, amount: Number(form.amount), payment_date: form.date, payment_type: student.tariff_type === 'monthly' ? 'monthly' : student.tariff_type === 'package' ? 'package' : 'per_lesson', lesson_id: null, package_id: null, notes: form.notes || null })
    onSaved()
  }
  return (
    <Modal title="Добавить платёж" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div><label className="label">Сумма (₽)</label><input className="input" type="number" required value={form.amount} onChange={(e) => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="2000" /></div>
        <div><label className="label">Дата</label><input className="input" type="date" required value={form.date} onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))} /></div>
        <div><label className="label">Заметки</label><input className="input" value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Сохранение...' : 'Добавить'}</button>
          <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        </div>
      </form>
    </Modal>
  )
}

function PackagesTab({ packages, studentId, onRefresh }: { packages: Package[]; studentId: string; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ total_lessons: '', price_total: '', purchase_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  async function addPackage(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('packages').insert({ student_id: studentId, total_lessons: Number(form.total_lessons), used_lessons: 0, price_total: Number(form.price_total), purchase_date: form.purchase_date, expires_at: null, notes: null })
    setShowAdd(false); setSaving(false); onRefresh()
  }
  return (
    <div className="space-y-3">
      <button onClick={() => setShowAdd(!showAdd)} className="btn-secondary">+ Новый пакет</button>
      {showAdd && (
        <form onSubmit={addPackage} className="card space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Занятий в пакете</label><input className="input" type="number" required value={form.total_lessons} onChange={(e) => setForm(p => ({ ...p, total_lessons: e.target.value }))} placeholder="10" /></div>
            <div><label className="label">Стоимость (₽)</label><input className="input" type="number" required value={form.price_total} onChange={(e) => setForm(p => ({ ...p, price_total: e.target.value }))} placeholder="15000" /></div>
          </div>
          <div><label className="label">Дата покупки</label><input className="input" type="date" required value={form.purchase_date} onChange={(e) => setForm(p => ({ ...p, purchase_date: e.target.value }))} /></div>
          <div className="flex gap-2"><button type="submit" disabled={saving} className="btn-primary">Добавить</button><button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Отмена</button></div>
        </form>
      )}
      {packages.map((pkg) => (
        <div key={pkg.id} className="card">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-medium text-gray-900">Пакет {pkg.total_lessons} занятий</p>
              <p className="text-sm text-gray-500 mt-0.5">Куплен {formatDate(pkg.purchase_date)} · {formatMoney(pkg.price_total)}</p>
            </div>
            <div className="text-right">
              <p className={`text-lg font-bold ${pkg.total_lessons - pkg.used_lessons > 0 ? 'text-sky-600' : 'text-red-500'}`}>{pkg.total_lessons - pkg.used_lessons}/{pkg.total_lessons}</p>
              <p className="text-xs text-gray-400">осталось занятий</p>
            </div>
          </div>
          <div className="mt-2 bg-gray-100 rounded-full h-2">
            <div className="bg-sky-500 h-2 rounded-full transition-all" style={{ width: `${(pkg.used_lessons / pkg.total_lessons) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function SubscriptionsTab({ subscriptions, studentId, onRefresh }: { subscriptions: MonthlySubscription[]; studentId: string; onRefresh: () => void }) {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  async function markPaid(subId: string) {
    await supabase.from('monthly_subscriptions').update({ paid_at: new Date().toISOString() }).eq('id', subId)
    onRefresh()
  }
  async function addMonth() {
    const amount = prompt('Сумма подписки (₽):')
    if (!amount) return
    await supabase.from('monthly_subscriptions').insert({ student_id: studentId, month: currentMonth, amount: Number(amount), lessons_count: 0, paid_at: null })
    onRefresh()
  }
  return (
    <div className="space-y-3">
      <button onClick={addMonth} className="btn-secondary">+ Добавить месяц</button>
      {subscriptions.map((sub) => (
        <div key={sub.id} className="card flex items-center justify-between">
          <div><p className="font-medium text-gray-900">{sub.month}</p><p className="text-sm text-gray-500">{formatMoney(sub.amount)}</p></div>
          <div className="flex items-center gap-3">
            {sub.paid_at ? <span className="badge bg-green-100 text-green-700">Оплачен {formatDate(sub.paid_at)}</span>
              : <button onClick={() => markPaid(sub.id)} className="btn-secondary text-sm text-green-700 border-green-200">Отметить оплату</button>}
          </div>
        </div>
      ))}
    </div>
  )
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

function EditStudentForm({ student, onSaved }: { student: Student; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: student.name, phone: student.phone || '', telegram_username: student.telegram_username || '',
    tariff_type: student.tariff_type, price_per_hour: String(student.price_per_hour),
    trial_price: student.trial_price ? String(student.trial_price) : '',
    language_level: (student as any).language_level || '',
    contact_name: (student as any).contact_name || '', contact_phone: (student as any).contact_phone || '',
    contact_relation: (student as any).contact_relation || '',
    can_group: (student as any).can_group || false, group_tag: (student as any).group_tag || '',
    notes: student.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    await supabase.from('students').update({
      name: form.name, phone: form.phone || null, telegram_username: form.telegram_username || null,
      tariff_type: form.tariff_type as any, price_per_hour: Number(form.price_per_hour),
      trial_price: form.trial_price ? Number(form.trial_price) : null,
      language_level: form.language_level || null, contact_name: form.contact_name || null,
      contact_phone: form.contact_phone || null, contact_relation: form.contact_relation || null,
      can_group: form.can_group, group_tag: form.can_group && form.group_tag ? form.group_tag : null,
      notes: form.notes || null,
    }).eq('id', student.id)
    setSaving(false); setSaved(true); onSaved()
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Основное</h3>
        <div><label className="label">Имя</label><input className="input" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Телефон</label><input className="input" value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
          <div><label className="label">Telegram</label><input className="input" value={form.telegram_username} onChange={(e) => setForm(p => ({ ...p, telegram_username: e.target.value }))} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Уровень английского</label>
            <select className="input" value={form.language_level} onChange={(e) => setForm(p => ({ ...p, language_level: e.target.value }))}>
              <option value="">Не указан</option>{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Тип тарифа</label>
            <select className="input" value={form.tariff_type} onChange={(e) => setForm(p => ({ ...p, tariff_type: e.target.value as any }))}>
              <option value="per_lesson">По занятию</option><option value="package">Пакет занятий</option><option value="monthly">Помесячно</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Ставка за час (₽)</label><input className="input" type="number" value={form.price_per_hour} onChange={(e) => setForm(p => ({ ...p, price_per_hour: e.target.value }))} /></div>
          <div><label className="label">Пробное занятие (₽)</label><input className="input" type="number" value={form.trial_price} onChange={(e) => setForm(p => ({ ...p, trial_price: e.target.value }))} /></div>
        </div>
      </div>
      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Контактное лицо</h3>
        <div><label className="label">Имя контакта</label><input className="input" value={form.contact_name} onChange={(e) => setForm(p => ({ ...p, contact_name: e.target.value }))} placeholder="Мария Петрова" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Телефон контакта</label><input className="input" value={form.contact_phone} onChange={(e) => setForm(p => ({ ...p, contact_phone: e.target.value }))} /></div>
          <div><label className="label">Кем приходится</label><input className="input" value={form.contact_relation} onChange={(e) => setForm(p => ({ ...p, contact_relation: e.target.value }))} placeholder="мама, муж, друг..." /></div>
        </div>
      </div>
      <div className="card space-y-4">
        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Мини-группы</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={form.can_group} onChange={(e) => setForm(p => ({ ...p, can_group: e.target.checked }))} />
          <div><p className="text-sm font-medium text-gray-700">Можно объединять в группу</p><p className="text-xs text-gray-400">Ученик согласен заниматься с другими в мини-группе</p></div>
        </label>
        {form.can_group && <div><label className="label">Метка группы</label><input className="input" value={form.group_tag} onChange={(e) => setForm(p => ({ ...p, group_tag: e.target.value }))} placeholder="Группа А, Подростки Б1..." /></div>}
      </div>
      <div className="card"><label className="label">Заметки</label><textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
      <button type="submit" disabled={saving} className="btn-primary">{saved ? '✓ Сохранено' : saving ? 'Сохранение...' : 'Сохранить изменения'}</button>
    </form>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

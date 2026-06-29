'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Payment, Student } from '@/lib/types'
import { formatDate, formatMoney } from '@/lib/utils'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'

export default function PaymentsPage() {
  const [payments, setPayments] = useState<(Payment & { student: Student })[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStudent, setFilterStudent] = useState('')
  const [monthOffset, setMonthOffset] = useState(0)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => { loadData() }, [monthOffset])

  async function loadData() {
    setLoading(true)
    const now = new Date()
    const month = subMonths(now, monthOffset)
    const from = startOfMonth(month).toISOString()
    const to = endOfMonth(month).toISOString()

    const [pRes, sRes] = await Promise.all([
      supabase
        .from('payments')
        .select('*, student:students(*)')
        .gte('payment_date', from)
        .lte('payment_date', to)
        .order('payment_date', { ascending: false }),
      supabase.from('students').select('*').eq('is_active', true).order('name'),
    ])

    setPayments((pRes.data || []) as any)
    setStudents(sRes.data || [])
    setLoading(false)
  }

  const now = new Date()
  const currentMonth = subMonths(now, monthOffset)
  const monthLabel = format(currentMonth, 'LLLL yyyy', { locale: ru })

  const filtered = filterStudent
    ? payments.filter((p) => p.student_id === filterStudent)
    : payments

  const totalAmount = filtered.reduce((s, p) => s + p.amount, 0)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Платежи</h1>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">+ Платёж</button>
      </div>

      {/* Навигация по месяцу */}
      <div className="flex items-center gap-3">
        <button onClick={() => setMonthOffset(m => m + 1)} className="btn-secondary px-3">←</button>
        <span className="text-sm font-semibold text-gray-700 capitalize">{monthLabel}</span>
        <button onClick={() => setMonthOffset(m => m - 1)} disabled={monthOffset === 0} className="btn-secondary px-3 disabled:opacity-40">→</button>
        {monthOffset !== 0 && (
          <button onClick={() => setMonthOffset(0)} className="btn-secondary text-sm">Текущий</button>
        )}
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">Всего получено</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{formatMoney(totalAmount)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Транзакций</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{filtered.length}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Средний платёж</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {filtered.length ? formatMoney(Math.round(totalAmount / filtered.length)) : '—'}
          </p>
        </div>
      </div>

      {/* Фильтр по ученику */}
      <div>
        <select
          className="input max-w-xs"
          value={filterStudent}
          onChange={(e) => setFilterStudent(e.target.value)}
        >
          <option value="">Все ученики</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Список платежей */}
      {loading ? (
        <div className="text-gray-400 text-sm">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-gray-400">Платежей за этот месяц нет</p>
          <button onClick={() => setShowAddModal(true)} className="btn-primary mt-4">+ Добавить платёж</button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} onDelete={loadData} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddPaymentModal
          students={students}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); loadData() }}
        />
      )}
    </div>
  )
}

function PaymentRow({ payment, onDelete }: { payment: Payment & { student: Student }; onDelete: () => void }) {
  async function deletePayment() {
    if (!confirm('Удалить платёж?')) return
    await supabase.from('payments').delete().eq('id', payment.id)
    onDelete()
  }

  return (
    <div className="card flex items-center justify-between py-3 group">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center text-sm font-semibold text-green-700">
          ₽
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{payment.student?.name}</p>
          <p className="text-xs text-gray-400">{formatDate(payment.payment_date)}{payment.notes ? ` · ${payment.notes}` : ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-base font-semibold text-green-600">{formatMoney(payment.amount)}</p>
        <button
          onClick={deletePayment}
          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function AddPaymentModal({ students, onClose, onSaved }: { students: Student[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    student_id: students[0]?.id || '',
    amount: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const selectedStudent = students.find(s => s.id === form.student_id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('payments').insert({
      student_id: form.student_id,
      amount: Number(form.amount),
      payment_date: form.date,
      payment_type: selectedStudent?.tariff_type === 'monthly' ? 'monthly'
        : selectedStudent?.tariff_type === 'package' ? 'package' : 'per_lesson',
      lesson_id: null,
      package_id: null,
      notes: form.notes || null,
    })
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold">Добавить платёж</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="label">Ученик</label>
            <select className="input" value={form.student_id} onChange={(e) => setForm(p => ({ ...p, student_id: e.target.value }))}>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Сумма (₽)</label>
            <input className="input" type="number" required value={form.amount} onChange={(e) => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="2000" />
          </div>
          <div>
            <label className="label">Дата</label>
            <input className="input" type="date" required value={form.date} onChange={(e) => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Заметки</label>
            <input className="input" value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Опционально" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Сохранение...' : 'Добавить'}</button>
            <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
          </div>
        </form>
      </div>
    </div>
  )
}

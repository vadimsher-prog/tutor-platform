'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { TariffType } from '@/lib/types'

export default function NewStudentPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    phone: '',
    telegram_username: '',
    tariff_type: 'per_lesson' as TariffType,
    price_per_hour: '',
    trial_price: '',
    notes: '',
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Введите имя'); return }
    if (!form.price_per_hour) { setError('Введите ставку'); return }

    setSaving(true)
    setError('')

    const { error: err } = await supabase.from('students').insert({
      name: form.name.trim(),
      phone: form.phone || null,
      telegram_username: form.telegram_username || null,
      tariff_type: form.tariff_type,
      price_per_hour: Number(form.price_per_hour),
      trial_price: form.trial_price ? Number(form.trial_price) : null,
      notes: form.notes || null,
      is_active: true,
    })

    if (err) {
      setError(err.message)
      setSaving(false)
    } else {
      router.push('/students')
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/students" className="text-gray-400 hover:text-gray-600 text-sm">← Ученики</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold text-gray-900">Новый ученик</h1>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="label">Имя *</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Иван Петров" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Телефон</label>
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+7 900 000 00 00" />
          </div>
          <div>
            <label className="label">Telegram</label>
            <input className="input" value={form.telegram_username} onChange={(e) => set('telegram_username', e.target.value)} placeholder="@username" />
          </div>
        </div>

        <div>
          <label className="label">Тип тарифа *</label>
          <select className="input" value={form.tariff_type} onChange={(e) => set('tariff_type', e.target.value)}>
            <option value="per_lesson">По занятию</option>
            <option value="package">Пакет занятий</option>
            <option value="monthly">Помесячно</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Ставка за час (₽) *</label>
            <input className="input" type="number" value={form.price_per_hour} onChange={(e) => set('price_per_hour', e.target.value)} placeholder="2000" />
          </div>
          <div>
            <label className="label">Цена пробного занятия (₽)</label>
            <input className="input" type="number" value={form.trial_price} onChange={(e) => set('trial_price', e.target.value)} placeholder="500" />
          </div>
        </div>

        <div>
          <label className="label">Заметки</label>
          <textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Уровень, цели, особенности..." />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Сохранение...' : 'Создать ученика'}
          </button>
          <Link href="/students" className="btn-secondary">Отмена</Link>
        </div>
      </form>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Student, Package, MonthlySubscription, Payment } from '@/lib/types'
import { formatMoney, tariffLabel } from '@/lib/utils'

interface StudentWithBalance extends Student {
  balance: number | null
  remaining_lessons: number | null
  subscription_paid: boolean | null
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentWithBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('active')

  useEffect(() => { loadStudents() }, [])

  async function loadStudents() {
    const { data: studentsData } = await supabase
      .from('students')
      .select('*')
      .order('name')

    if (!studentsData) { setLoading(false); return }

    // Обогащаем данными по балансу/пакетам
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const enriched: StudentWithBalance[] = await Promise.all(
      studentsData.map(async (s) => {
        let balance: number | null = null
        let remaining_lessons: number | null = null
        let subscription_paid: boolean | null = null

        if (s.tariff_type === 'per_lesson') {
          const { data: payments } = await supabase
            .from('payments')
            .select('amount')
            .eq('student_id', s.id)
          const { data: lessons } = await supabase
            .from('lessons')
            .select('duration_minutes')
            .eq('student_id', s.id)
            .eq('status', 'completed')
          const paid = (payments || []).reduce((sum, p) => sum + p.amount, 0)
          const cost = (lessons || []).reduce((sum, l) => sum + (l.duration_minutes / 60) * s.price_per_hour, 0)
          balance = paid - cost

        } else if (s.tariff_type === 'package') {
          const { data: pkg } = await supabase
            .from('packages')
            .select('*')
            .eq('student_id', s.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
          if (pkg) remaining_lessons = pkg.total_lessons - pkg.used_lessons

        } else if (s.tariff_type === 'monthly') {
          const { data: sub } = await supabase
            .from('monthly_subscriptions')
            .select('paid_at')
            .eq('student_id', s.id)
            .eq('month', currentMonth)
            .single()
          subscription_paid = !!sub?.paid_at
        }

        return { ...s, balance, remaining_lessons, subscription_paid }
      })
    )

    setStudents(enriched)
    setLoading(false)
  }

  const filtered = students.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase())
    const matchesFilter =
      filter === 'all' ||
      (filter === 'active' && s.is_active) ||
      (filter === 'inactive' && !s.is_active)
    return matchesSearch && matchesFilter
  })

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Ученики</h1>
        <Link href="/students/new" className="btn-primary">+ Добавить ученика</Link>
      </div>

      {/* Фильтры */}
      <div className="flex gap-3">
        <input
          type="search"
          placeholder="Поиск по имени..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-xs"
        />
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {(['active', 'all', 'inactive'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 ${filter === f ? 'bg-sky-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {f === 'active' ? 'Активные' : f === 'all' ? 'Все' : 'Архив'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">Ученики не найдены</p>
          <Link href="/students/new" className="btn-primary mt-4 inline-flex">+ Добавить ученика</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((student) => (
            <Link
              key={student.id}
              href={`/students/${student.id}`}
              className="card flex items-center justify-between hover:border-sky-200 hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 bg-sky-100 rounded-full flex items-center justify-center text-lg font-semibold text-sky-700">
                  {student.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 group-hover:text-sky-700">{student.name}</p>
                    {!student.is_active && (
                      <span className="badge bg-gray-100 text-gray-500">Архив</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500">{tariffLabel(student.tariff_type)}</span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-500">{formatMoney(student.price_per_hour)}/час</span>
                    {student.phone && (
                      <>
                        <span className="text-xs text-gray-300">·</span>
                        <span className="text-xs text-gray-500">{student.phone}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <BalanceBadge student={student} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function BalanceBadge({ student }: { student: StudentWithBalance }) {
  if (student.tariff_type === 'per_lesson' && student.balance !== null) {
    const color = student.balance >= 0 ? 'text-green-600' : 'text-red-600'
    return (
      <div>
        <p className={`text-sm font-semibold ${color}`}>{formatMoney(student.balance)}</p>
        <p className="text-xs text-gray-400">{student.balance >= 0 ? 'переплата' : 'долг'}</p>
      </div>
    )
  }
  if (student.tariff_type === 'package' && student.remaining_lessons !== null) {
    const color = student.remaining_lessons > 0 ? 'text-sky-600' : 'text-red-600'
    return (
      <div>
        <p className={`text-sm font-semibold ${color}`}>{student.remaining_lessons}</p>
        <p className="text-xs text-gray-400">занятий осталось</p>
      </div>
    )
  }
  if (student.tariff_type === 'monthly' && student.subscription_paid !== null) {
    return student.subscription_paid ? (
      <span className="badge bg-green-100 text-green-700">Оплачен</span>
    ) : (
      <span className="badge bg-red-100 text-red-700">Не оплачен</span>
    )
  }
  return null
}

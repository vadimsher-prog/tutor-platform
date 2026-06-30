'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Lesson, Student, Payment } from '@/lib/types'
import { formatDateTime, formatTime, formatMoney, tariffLabel } from '@/lib/utils'

interface DashboardData {
  todayLessons: (Lesson & { student: Student })[]
  weekLessons: (Lesson & { student: Student })[]
  debtors: { student: Student; balance: number }[]
  stats: {
    totalStudents: number
    monthIncome: number
    monthLessons: number
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [todayRes, weekRes, studentsRes, monthPayRes, monthLesRes] = await Promise.all([
      supabase
        .from('lessons')
        .select('*, student:students(*)')
        .gte('scheduled_at', todayStart)
        .lt('scheduled_at', todayEnd)
        .eq('status', 'scheduled')
        .order('scheduled_at'),
      supabase
        .from('lessons')
        .select('*, student:students(*)')
        .gt('scheduled_at', todayEnd)
        .lt('scheduled_at', weekEnd)
        .eq('status', 'scheduled')
        .order('scheduled_at'),
      supabase.from('students').select('*').eq('is_active', true),
      supabase
        .from('payments')
        .select('amount')
        .gte('payment_date', monthStart),
      supabase
        .from('lessons')
        .select('id')
        .gte('scheduled_at', monthStart)
        .eq('status', 'completed'),
    ])

    const monthIncome = (monthPayRes.data || []).reduce((s: number, p: any) => s + p.amount, 0)

    setData({
      todayLessons: (todayRes.data || []) as any,
      weekLessons: (weekRes.data || []) as any,
      debtors: [],
      stats: {
        totalStudents: studentsRes.data?.length || 0,
        monthIncome,
        monthLessons: monthLesRes.data?.length || 0,
      },
    })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    )
  }

  async function completeAllToday() {
    if (!data?.todayLessons.length) return
    setCompleting(true)
    const ids = data.todayLessons.map(l => l.id)
    await (supabase.from('lessons') as any).update({ status: 'completed' }).in('id', ids)
    setCompleting(false)
    loadDashboard()
  }

  const { todayLessons, weekLessons, stats } = data!

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">Активных учеников</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{stats.totalStudents}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Доход в этом месяце</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{formatMoney(stats.monthIncome)}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Занятий в этом месяце</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{stats.monthLessons}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Занятия сегодня */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Сегодня</h2>
            <div className="flex items-center gap-3">
              {todayLessons.length > 0 && (
                <button
                  onClick={completeAllToday}
                  disabled={completing}
                  className="text-xs text-green-700 hover:text-green-900 font-medium disabled:opacity-50"
                >
                  {completing ? 'Сохранение...' : '✓ Провести все'}
                </button>
              )}
              <Link href="/schedule" className="text-sm text-sky-600 hover:underline">Расписание →</Link>
            </div>
          </div>
          {todayLessons.length === 0 ? (
            <p className="text-sm text-gray-400">Занятий нет</p>
          ) : (
            <div className="space-y-2">
              {todayLessons.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} />
              ))}
            </div>
          )}
        </div>

        {/* Ближайшие 7 дней */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Следующие 7 дней</h2>
          </div>
          {weekLessons.length === 0 ? (
            <p className="text-sm text-gray-400">Занятий нет</p>
          ) : (
            <div className="space-y-2">
              {weekLessons.slice(0, 6).map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} showDate />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Быстрые действия */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-3">Быстрые действия</h2>
        <div className="flex gap-3">
          <Link href="/students/new" className="btn-primary">+ Новый ученик</Link>
          <Link href="/schedule?action=add" className="btn-secondary">+ Занятие</Link>
          <Link href="/payments?action=add" className="btn-secondary">+ Платёж</Link>
        </div>
      </div>
    </div>
  )
}

function LessonRow({ lesson, showDate }: { lesson: Lesson & { student: Student }; showDate?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center text-sm font-medium text-sky-700">
          {lesson.student?.name?.charAt(0) || '?'}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{lesson.student?.name}</p>
          <p className="text-xs text-gray-500">
            {showDate ? formatDateTime(lesson.scheduled_at) : formatTime(lesson.scheduled_at)}
            {' · '}{lesson.duration_minutes} мин
          </p>
        </div>
      </div>
      {lesson.is_trial && (
        <span className="badge bg-purple-100 text-purple-700">Пробное</span>
      )}
    </div>
  )
}

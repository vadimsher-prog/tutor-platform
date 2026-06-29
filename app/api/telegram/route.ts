import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Supabase с service key для серверного доступа
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const ALLOWED_USER_ID = Number(process.env.TELEGRAM_ALLOWED_USER_ID!)

async function sendMessage(chatId: number, text: string, parseMode = 'HTML') {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message = body?.message
    if (!message) return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const userId: number = message.from?.id
    const text: string = (message.text || '').trim()

    // Проверяем что пишет только хозяин
    if (userId !== ALLOWED_USER_ID) {
      await sendMessage(chatId, '⛔ Нет доступа')
      return NextResponse.json({ ok: true })
    }

    await handleCommand(chatId, text)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Telegram webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}

async function handleCommand(chatId: number, text: string) {
  const lower = text.toLowerCase()

  // /start или /help
  if (lower === '/start' || lower === '/help') {
    await sendMessage(chatId, `
<b>🎓 Репетитор-бот</b>

<b>Платежи:</b>
/pay Имя 2000 — записать оплату
/pay Имя 2000 за январь — с заметкой

<b>Расписание:</b>
/cancel Имя 28.06 — отменить занятие
/reschedule Имя 28.06 на 30.06 14:00 — перенести

<b>Информация:</b>
/student Имя — баланс и ближайшее занятие
/today — занятия сегодня
/week — занятия на этой неделе
/debts — кто должен
    `.trim())
    return
  }

  // /today
  if (lower === '/today') {
    const today = new Date()
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()

    const { data: lessons } = await supabase
      .from('lessons')
      .select('*, student:students(name)')
      .gte('scheduled_at', from)
      .lt('scheduled_at', to)
      .eq('status', 'scheduled')
      .order('scheduled_at')

    if (!lessons || lessons.length === 0) {
      await sendMessage(chatId, '📅 Сегодня занятий нет')
      return
    }

    const lines = lessons.map((l: any) => {
      const time = new Date(l.scheduled_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return `• ${time} — <b>${l.student?.name}</b> (${l.duration_minutes} мин)`
    })
    await sendMessage(chatId, `📅 <b>Сегодня:</b>\n${lines.join('\n')}`)
    return
  }

  // /week
  if (lower === '/week') {
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString()

    const { data: lessons } = await supabase
      .from('lessons')
      .select('*, student:students(name)')
      .gte('scheduled_at', from)
      .lt('scheduled_at', to)
      .eq('status', 'scheduled')
      .order('scheduled_at')

    if (!lessons || lessons.length === 0) {
      await sendMessage(chatId, '📅 На этой неделе занятий нет')
      return
    }

    const lines = lessons.map((l: any) => {
      const dt = new Date(l.scheduled_at)
      const date = dt.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
      const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      return `• ${date} ${time} — <b>${l.student?.name}</b>`
    })
    await sendMessage(chatId, `📅 <b>На этой неделе (${lessons.length}):</b>\n${lines.join('\n')}`)
    return
  }

  // /debts
  if (lower === '/debts') {
    const { data: students } = await supabase
      .from('students')
      .select('*')
      .eq('is_active', true)
      .eq('tariff_type', 'per_lesson')

    if (!students || students.length === 0) {
      await sendMessage(chatId, '✅ Должников нет')
      return
    }

    const debtors: string[] = []
    for (const s of students) {
      const { data: payments } = await supabase.from('payments').select('amount').eq('student_id', s.id)
      const { data: lessons } = await supabase.from('lessons').select('duration_minutes').eq('student_id', s.id).eq('status', 'completed')
      const paid = (payments || []).reduce((sum: number, p: any) => sum + p.amount, 0)
      const cost = (lessons || []).reduce((sum: number, l: any) => sum + (l.duration_minutes / 60) * s.price_per_hour, 0)
      const balance = paid - cost
      if (balance < -100) {
        debtors.push(`• <b>${s.name}</b>: ${Math.abs(Math.round(balance))} ₽ долг`)
      }
    }

    if (debtors.length === 0) {
      await sendMessage(chatId, '✅ Должников нет')
    } else {
      await sendMessage(chatId, `💰 <b>Должники:</b>\n${debtors.join('\n')}`)
    }
    return
  }

  // /pay Имя сумма [заметка]
  const payMatch = text.match(/^\/pay\s+(.+?)\s+(\d+)(.*)$/i)
  if (payMatch) {
    const namePart = payMatch[1].trim()
    const amount = Number(payMatch[2])
    const notes = payMatch[3].trim().replace(/^за\s+/i, '') || null

    const student = await findStudent(namePart)
    if (!student) {
      await sendMessage(chatId, `❌ Ученик «${namePart}» не найден\n\nПопробуй /pay Имя 2000`)
      return
    }

    await supabase.from('payments').insert({
      student_id: student.id,
      amount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_type: student.tariff_type === 'monthly' ? 'monthly' : student.tariff_type === 'package' ? 'package' : 'per_lesson',
      lesson_id: null,
      package_id: null,
      notes,
    })

    await sendMessage(chatId, `✅ Записал: <b>${student.name}</b> оплатил ${amount} ₽${notes ? ` (${notes})` : ''}`)
    return
  }

  // /student Имя
  const studentMatch = text.match(/^\/student\s+(.+)$/i)
  if (studentMatch) {
    const namePart = studentMatch[1].trim()
    const student = await findStudent(namePart)
    if (!student) {
      await sendMessage(chatId, `❌ Ученик «${namePart}» не найден`)
      return
    }

    // Баланс
    let balanceInfo = ''
    if (student.tariff_type === 'per_lesson') {
      const { data: payments } = await supabase.from('payments').select('amount').eq('student_id', student.id)
      const { data: lessons } = await supabase.from('lessons').select('duration_minutes').eq('student_id', student.id).eq('status', 'completed')
      const paid = (payments || []).reduce((s: number, p: any) => s + p.amount, 0)
      const cost = (lessons || []).reduce((s: number, l: any) => s + (l.duration_minutes / 60) * student.price_per_hour, 0)
      const bal = Math.round(paid - cost)
      balanceInfo = bal >= 0 ? `💚 Переплата: ${bal} ₽` : `🔴 Долг: ${Math.abs(bal)} ₽`
    }

    // Ближайшее занятие
    const { data: nextLesson } = await supabase
      .from('lessons')
      .select('scheduled_at, duration_minutes')
      .eq('student_id', student.id)
      .eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .limit(1)
      .single()

    const nextInfo = nextLesson
      ? `📅 Следующее: ${new Date(nextLesson.scheduled_at).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
      : '📅 Занятий не запланировано'

    await sendMessage(chatId, `👤 <b>${student.name}</b>\nТариф: ${tariffLabelRu(student.tariff_type)} · ${student.price_per_hour} ₽/час\n${balanceInfo}\n${nextInfo}`)
    return
  }

  // /cancel Имя дата
  const cancelMatch = text.match(/^\/cancel\s+(.+?)\s+(\d{1,2}\.\d{2}(?:\.\d{4})?)/i)
  if (cancelMatch) {
    const namePart = cancelMatch[1].trim()
    const datePart = cancelMatch[2]
    const student = await findStudent(namePart)
    if (!student) {
      await sendMessage(chatId, `❌ Ученик «${namePart}» не найден`)
      return
    }

    const lesson = await findLesson(student.id, datePart)
    if (!lesson) {
      await sendMessage(chatId, `❌ Занятие ${datePart} не найдено для ${student.name}`)
      return
    }

    await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lesson.id)
    const dt = new Date(lesson.scheduled_at)
    const dateStr = dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    await sendMessage(chatId, `✅ Занятие <b>${student.name}</b> ${dateStr} — отменено`)
    return
  }

  // /reschedule Имя дата на дата время
  const rescheduleMatch = text.match(/^\/reschedule\s+(.+?)\s+(\d{1,2}\.\d{2}(?:\.\d{4})?)\s+на\s+(\d{1,2}\.\d{2}(?:\.\d{4})?)\s+(\d{2}:\d{2})/i)
  if (rescheduleMatch) {
    const namePart = rescheduleMatch[1].trim()
    const oldDate = rescheduleMatch[2]
    const newDate = rescheduleMatch[3]
    const newTime = rescheduleMatch[4]

    const student = await findStudent(namePart)
    if (!student) {
      await sendMessage(chatId, `❌ Ученик «${namePart}» не найден`)
      return
    }

    const lesson = await findLesson(student.id, oldDate)
    if (!lesson) {
      await sendMessage(chatId, `❌ Занятие ${oldDate} не найдено для ${student.name}`)
      return
    }

    // Формируем новую дату
    const [newDay, newMonth, newYear] = newDate.split('.')
    const year = newYear || new Date().getFullYear().toString()
    const newScheduledAt = new Date(`${year}-${newMonth}-${newDay.padStart(2, '0')}T${newTime}:00`).toISOString()

    // Старое занятие помечаем как перенесённое, создаём новое
    await supabase.from('lessons').update({ status: 'rescheduled' }).eq('id', lesson.id)
    await supabase.from('lessons').insert({
      student_id: student.id,
      scheduled_at: newScheduledAt,
      duration_minutes: lesson.duration_minutes,
      status: 'scheduled',
      is_trial: lesson.is_trial,
      notes: `Перенесено с ${oldDate}`,
      google_event_id: null,
    })

    await sendMessage(chatId, `✅ Занятие <b>${student.name}</b> перенесено на ${newDate} в ${newTime}`)
    return
  }

  // Неизвестная команда
  await sendMessage(chatId, '❓ Не понял команду. Напиши /help')
}

async function findStudent(namePart: string) {
  const { data } = await supabase
    .from('students')
    .select('*')
    .ilike('name', `%${namePart}%`)
    .eq('is_active', true)
    .order('name')
    .limit(1)
  return data?.[0] || null
}

async function findLesson(studentId: string, datePart: string) {
  const [day, month, year] = datePart.split('.')
  const y = year || new Date().getFullYear().toString()
  const dateStr = `${y}-${month}-${day.padStart(2, '0')}`

  const { data } = await supabase
    .from('lessons')
    .select('*')
    .eq('student_id', studentId)
    .gte('scheduled_at', `${dateStr}T00:00:00`)
    .lt('scheduled_at', `${dateStr}T23:59:59`)
    .in('status', ['scheduled', 'rescheduled'])
    .limit(1)
  return data?.[0] || null
}

function tariffLabelRu(type: string): string {
  const map: Record<string, string> = {
    per_lesson: 'По занятию',
    package: 'Пакет',
    monthly: 'Помесячно',
  }
  return map[type] || type
}

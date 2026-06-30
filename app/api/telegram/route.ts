import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const ALLOWED_USER_ID = Number(process.env.TELEGRAM_ALLOWED_USER_ID!)
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

// ──────────────────────────────────────────────
// In-memory state (single user bot)
// ──────────────────────────────────────────────
interface UserState {
  step: string
  studentId?: string
  lessonId?: string
  lessonLabel?: string
  newDate?: string  // YYYY-MM-DD for reschedule
}
const userState: Record<number, UserState> = {}

// ──────────────────────────────────────────────
// Telegram API helpers
// ──────────────────────────────────────────────
async function tg(method: string, body: object) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function send(chatId: number, text: string, keyboard?: object) {
  return tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
}

async function edit(chatId: number, messageId: number, text: string, keyboard?: object) {
  return tg('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
}

async function answerCb(id: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) })
}

function inlineKb(rows: Array<Array<{ text: string; callback_data: string }>>) {
  return { inline_keyboard: rows }
}

// ──────────────────────────────────────────────
// Keyboards
// ──────────────────────────────────────────────
function mainMenu() {
  return inlineKb([
    [
      { text: '💰 Оплата', callback_data: 'PAY' },
      { text: '✕ Отмена занятия', callback_data: 'CXL' },
      { text: '↩ Перенос', callback_data: 'RSC' },
    ],
    [
      { text: '📅 Сегодня', callback_data: 'TODAY' },
      { text: '📆 Неделя', callback_data: 'WEEK' },
      { text: '💸 Долги', callback_data: 'DEBTS' },
    ],
  ])
}

/** Date picker: yesterday + today + tomorrow + next 5 days */
function datePicker(cbPrefix: string) {
  const days = [-1, 0, 1, 2, 3, 4, 5, 6].map(offset => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const iso = d.toISOString().split('T')[0]
    let label: string
    if (offset === -1) label = `Вчера ${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`
    else if (offset === 0) label = `Сегодня ${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`
    else if (offset === 1) label = `Завтра ${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')}`
    else label = d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'numeric' })
    return { text: label, callback_data: `${cbPrefix}:${iso}` }
  })
  return inlineKb([
    days.slice(0, 3),
    days.slice(3, 6),
    days.slice(6),
    [{ text: '✕ Отмена', callback_data: 'ABORT' }],
  ])
}

/** Time picker: 30-min slots 8:00–21:00, 4 per row */
function timePicker(cbPrefix: string) {
  const slots: { text: string; callback_data: string }[] = []
  for (let h = 8; h <= 21; h++) {
    for (const m of [0, 30]) {
      if (h === 21 && m === 30) break
      const time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
      slots.push({ text: time, callback_data: `${cbPrefix}:${time}` })
    }
  }
  const rows: typeof slots[] = []
  for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4))
  rows.push([{ text: '✕ Отмена', callback_data: 'ABORT' }])
  return inlineKb(rows)
}

// ──────────────────────────────────────────────
// POST handler
// ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Handle callback_query (button presses)
    if (body.callback_query) {
      const cb = body.callback_query
      const userId: number = cb.from.id
      const chatId: number = cb.message.chat.id
      const msgId: number = cb.message.message_id
      const data: string = cb.data

      if (userId !== ALLOWED_USER_ID) { await answerCb(cb.id); return NextResponse.json({ ok: true }) }

      await answerCb(cb.id)
      await handleCallback(chatId, msgId, userId, data)
      return NextResponse.json({ ok: true })
    }

    // Handle message
    const message = body?.message
    if (!message) return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const userId: number = message.from?.id
    const text: string = (message.text || '').trim()

    if (userId !== ALLOWED_USER_ID) {
      await send(chatId, '⛔ Нет доступа')
      return NextResponse.json({ ok: true })
    }

    await handleMessage(chatId, userId, text)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Telegram webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}

// ──────────────────────────────────────────────
// Callback handler
// ──────────────────────────────────────────────
async function handleCallback(chatId: number, msgId: number, userId: number, data: string) {

  // ── Quick info ───────────────────────────────
  if (data === 'TODAY') { await edit(chatId, msgId, await getTodayText(), mainMenu()); return }
  if (data === 'WEEK')  { await edit(chatId, msgId, await getWeekText(),  mainMenu()); return }
  if (data === 'DEBTS') { await edit(chatId, msgId, await getDebtsText(), mainMenu()); return }

  if (data === 'ABORT') {
    delete userState[userId]
    await edit(chatId, msgId, '↩ Операция отменена', mainMenu())
    return
  }

  // ── ОПЛАТА ──────────────────────────────────
  if (data === 'PAY') {
    const students = await getActiveStudents()
    if (!students.length) { await edit(chatId, msgId, '❌ Нет активных учеников', mainMenu()); return }
    const rows = chunkArray(students.map(s => ({ text: s.name, callback_data: `PAY_S:${s.id}` })), 2)
    rows.push([{ text: '✕ Отмена', callback_data: 'ABORT' }])
    userState[userId] = { step: 'pay_select_student' }
    await edit(chatId, msgId, '💰 <b>Оплата</b>\n\nВыбери ученика:', inlineKb(rows))
    return
  }

  if (data.startsWith('PAY_S:')) {
    const studentId = data.slice(6)
    const student = await getStudentById(studentId)
    if (!student) { await edit(chatId, msgId, '❌ Ученик не найден', mainMenu()); return }
    userState[userId] = { step: 'pay_enter_amount', studentId, lessonLabel: student.name }
    await edit(chatId, msgId, `💰 Оплата для <b>${student.name}</b>\n\nВведи сумму (только цифры):`)
    return
  }

  // ── ОТМЕНА ЗАНЯТИЯ ───────────────────────────
  if (data === 'CXL') {
    userState[userId] = { step: 'cxl_select_date' }
    await edit(chatId, msgId, '✕ <b>Отмена занятия</b>\n\nВыбери дату:', datePicker('CXL_DT'))
    return
  }

  if (data.startsWith('CXL_DT:')) {
    const date = data.slice(7)
    const lessons = await getLessonsForDate(date)
    if (!lessons.length) {
      await edit(chatId, msgId, `❌ На <b>${formatDate(date)}</b> занятий нет`,
        inlineKb([[{ text: '← Назад', callback_data: 'CXL' }, { text: '✕ Отмена', callback_data: 'ABORT' }]]))
      return
    }
    const rows = lessons.map((l: any) => [{ text: `${formatTime(l.scheduled_at)} — ${l.student?.name}`, callback_data: `CXL_L:${l.id}` }])
    rows.push([{ text: '← Назад', callback_data: 'CXL' }, { text: '✕ Отмена', callback_data: 'ABORT' }])
    userState[userId] = { step: 'cxl_select_lesson' }
    await edit(chatId, msgId, `✕ Занятия на <b>${formatDate(date)}</b>:`, inlineKb(rows))
    return
  }

  if (data.startsWith('CXL_L:')) {
    const lessonId = data.slice(6)
    const lesson = await getLessonById(lessonId)
    if (!lesson) { await edit(chatId, msgId, '❌ Занятие не найдено', mainMenu()); return }
    const label = `${lesson.student?.name} — ${formatDateTime(lesson.scheduled_at)}`
    userState[userId] = { step: 'cxl_confirm', lessonId, lessonLabel: label }
    await edit(chatId, msgId, `✕ Отменить занятие?\n\n<b>${label}</b>`,
      inlineKb([
        [{ text: '✓ Да, отменить', callback_data: `CXL_OK:${lessonId}` }],
        [{ text: '← Назад', callback_data: 'CXL' }, { text: '✕ Отмена', callback_data: 'ABORT' }],
      ])
    )
    return
  }

  if (data.startsWith('CXL_OK:')) {
    const lessonId = data.slice(7)
    await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lessonId)
    const label = userState[userId]?.lessonLabel || ''
    delete userState[userId]
    await edit(chatId, msgId, `✅ Занятие отменено:\n<b>${label}</b>`, mainMenu())
    return
  }

  // ── ПЕРЕНОС ─────────────────────────────────
  if (data === 'RSC') {
    userState[userId] = { step: 'rsc_select_date' }
    await edit(chatId, msgId, '↩ <b>Перенос занятия</b>\n\nВыбери дату <i>переносимого</i> занятия:', datePicker('RSC_DT'))
    return
  }

  if (data.startsWith('RSC_DT:')) {
    const date = data.slice(7)
    const lessons = await getLessonsForDate(date)
    if (!lessons.length) {
      await edit(chatId, msgId, `❌ На <b>${formatDate(date)}</b> занятий нет`,
        inlineKb([[{ text: '← Назад', callback_data: 'RSC' }, { text: '✕ Отмена', callback_data: 'ABORT' }]]))
      return
    }
    const rows = lessons.map((l: any) => [{ text: `${formatTime(l.scheduled_at)} — ${l.student?.name}`, callback_data: `RSC_L:${l.id}` }])
    rows.push([{ text: '← Назад', callback_data: 'RSC' }, { text: '✕ Отмена', callback_data: 'ABORT' }])
    userState[userId] = { step: 'rsc_select_lesson' }
    await edit(chatId, msgId, `↩ Занятия на <b>${formatDate(date)}</b>:`, inlineKb(rows))
    return
  }

  if (data.startsWith('RSC_L:')) {
    const lessonId = data.slice(6)
    const lesson = await getLessonById(lessonId)
    if (!lesson) { await edit(chatId, msgId, '❌ Занятие не найдено', mainMenu()); return }
    const label = `${lesson.student?.name} — ${formatDateTime(lesson.scheduled_at)}`
    userState[userId] = { step: 'rsc_select_new_date', lessonId, lessonLabel: label }
    await edit(chatId, msgId, `↩ Переносим:\n<b>${label}</b>\n\nВыбери <i>новую</i> дату:`, datePicker('RSC_NDT'))
    return
  }

  if (data.startsWith('RSC_NDT:')) {
    const newDate = data.slice(8)
    const state = userState[userId]
    if (!state?.lessonId) { await edit(chatId, msgId, '❌ Сессия устарела, начни заново', mainMenu()); return }
    userState[userId] = { ...state, step: 'rsc_select_new_time', newDate }
    await edit(chatId, msgId,
      `↩ Переносим:\n<b>${state.lessonLabel}</b>\n\nНовая дата: <b>${formatDate(newDate)}</b>\nВыбери время:`,
      timePicker('RSC_NT')
    )
    return
  }

  if (data.startsWith('RSC_NT:')) {
    const newTime = data.slice(7)
    const state = userState[userId]
    if (!state?.lessonId || !state?.newDate) { await edit(chatId, msgId, '❌ Сессия устарела, начни заново', mainMenu()); return }
    // Store new time in lessonId slot temporarily — encode as lessonId|newDate|newTime
    await edit(chatId, msgId,
      `↩ Подтверди перенос:\n\n<s>${state.lessonLabel}</s>\n→ <b>${formatDate(state.newDate)} в ${newTime}</b>`,
      inlineKb([
        [{ text: '✓ Да, перенести', callback_data: `RSC_OK:${state.lessonId}:${state.newDate}:${newTime}` }],
        [{ text: '← Изменить время', callback_data: `RSC_NDT:${state.newDate}` }, { text: '✕ Отмена', callback_data: 'ABORT' }],
      ])
    )
    return
  }

  if (data.startsWith('RSC_OK:')) {
    // RSC_OK:{lessonId}:{YYYY-MM-DD}:{HH:MM}
    const parts = data.slice(7).split(':')
    const lessonId = parts[0]
    const newDate = parts[1]
    const newTime = `${parts[2]}:${parts[3]}`

    const lesson = await getLessonById(lessonId)
    if (!lesson) { await edit(chatId, msgId, '❌ Занятие не найдено', mainMenu()); return }

    const newScheduledAt = new Date(`${newDate}T${newTime}:00`).toISOString()
    await supabase.from('lessons').update({ status: 'rescheduled' }).eq('id', lessonId)
    await supabase.from('lessons').insert({
      student_id: lesson.student_id,
      scheduled_at: newScheduledAt,
      duration_minutes: lesson.duration_minutes,
      status: 'scheduled',
      is_trial: lesson.is_trial,
      notes: `Перенесено с ${formatDateTime(lesson.scheduled_at)}`,
      google_event_id: null,
    })

    const oldLabel = userState[userId]?.lessonLabel || `${lesson.student?.name} — ${formatDateTime(lesson.scheduled_at)}`
    delete userState[userId]
    await edit(chatId, msgId,
      `✅ Перенос выполнен:\n<s>${oldLabel}</s>\n→ <b>${formatDate(newDate)} в ${newTime}</b>`,
      mainMenu()
    )
    return
  }

  // Fallback
  await send(chatId, '❓ Неизвестная команда', mainMenu())
}

// ──────────────────────────────────────────────
// Message handler
// ──────────────────────────────────────────────
async function handleMessage(chatId: number, userId: number, text: string) {
  const lower = text.toLowerCase()
  const state = userState[userId]

  // ── Stateful input: payment amount ──────────
  if (state?.step === 'pay_enter_amount') {
    const amount = Number(text.replace(/[^\d]/g, ''))
    if (!amount || amount <= 0) {
      await send(chatId, '❌ Введи сумму числом, например: <b>2000</b>')
      return
    }
    const student = await getStudentById(state.studentId!)
    if (!student) { delete userState[userId]; await send(chatId, '❌ Ученик не найден'); return }

    await supabase.from('payments').insert({
      student_id: student.id,
      amount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_type: student.tariff_type === 'monthly' ? 'monthly' : student.tariff_type === 'package' ? 'package' : 'per_lesson',
      lesson_id: null, package_id: null, notes: null,
    })
    delete userState[userId]
    await send(chatId, `✅ Оплата записана:\n<b>${state.lessonLabel}</b> — ${amount} ₽`, mainMenu())
    return
  }

  // ── Commands ─────────────────────────────────
  if (lower === '/start' || lower === '/help' || lower === '/menu') {
    delete userState[userId]
    await send(chatId, `🎓 <b>Репетитор-бот</b>\n\nВыбери действие или используй текстовые команды:`, mainMenu())
    return
  }

  if (lower === '/today') { await send(chatId, await getTodayText()); return }
  if (lower === '/week')  { await send(chatId, await getWeekText());  return }
  if (lower === '/debts') { await send(chatId, await getDebtsText()); return }

  // /pay Имя сумма
  const payMatch = text.match(/^\/pay\s+(.+?)\s+(\d+)(.*)$/i)
  if (payMatch) {
    const student = await findStudent(payMatch[1].trim())
    if (!student) { await send(chatId, `❌ Ученик «${payMatch[1]}» не найден`); return }
    const amount = Number(payMatch[2])
    const notes = payMatch[3].trim().replace(/^за\s+/i, '') || null
    await supabase.from('payments').insert({ student_id: student.id, amount, payment_date: new Date().toISOString().split('T')[0], payment_type: student.tariff_type === 'monthly' ? 'monthly' : student.tariff_type === 'package' ? 'package' : 'per_lesson', lesson_id: null, package_id: null, notes })
    await send(chatId, `✅ <b>${student.name}</b> оплатил ${amount} ₽${notes ? ` (${notes})` : ''}`)
    return
  }

  // /student Имя
  const studentMatch = text.match(/^\/student\s+(.+)$/i)
  if (studentMatch) {
    const student = await findStudent(studentMatch[1].trim())
    if (!student) { await send(chatId, `❌ Ученик «${studentMatch[1]}» не найден`); return }
    await send(chatId, await getStudentInfo(student))
    return
  }

  // /cancel Имя дата
  const cancelMatch = text.match(/^\/cancel\s+(.+?)\s+(\d{1,2}\.\d{2}(?:\.\d{4})?)/i)
  if (cancelMatch) {
    const student = await findStudent(cancelMatch[1].trim())
    if (!student) { await send(chatId, `❌ Ученик «${cancelMatch[1]}» не найден`); return }
    const lesson = await findLesson(student.id, cancelMatch[2])
    if (!lesson) { await send(chatId, `❌ Занятие ${cancelMatch[2]} не найдено для ${student.name}`); return }
    await supabase.from('lessons').update({ status: 'cancelled' }).eq('id', lesson.id)
    await send(chatId, `✅ Занятие <b>${student.name}</b> ${formatDateTime(lesson.scheduled_at)} — отменено`)
    return
  }

  // /reschedule Имя дата на дата время
  const rescheduleMatch = text.match(/^\/reschedule\s+(.+?)\s+(\d{1,2}\.\d{2}(?:\.\d{4})?)\s+на\s+(\d{1,2}\.\d{2}(?:\.\d{4})?)\s+(\d{2}:\d{2})/i)
  if (rescheduleMatch) {
    const student = await findStudent(rescheduleMatch[1].trim())
    if (!student) { await send(chatId, `❌ Ученик «${rescheduleMatch[1]}» не найден`); return }
    const lesson = await findLesson(student.id, rescheduleMatch[2])
    if (!lesson) { await send(chatId, `❌ Занятие ${rescheduleMatch[2]} не найдено для ${student.name}`); return }
    const [d, m, y] = rescheduleMatch[3].split('.')
    const year = y || new Date().getFullYear().toString()
    const newScheduledAt = new Date(`${year}-${m}-${d.padStart(2, '0')}T${rescheduleMatch[4]}:00`).toISOString()
    await supabase.from('lessons').update({ status: 'rescheduled' }).eq('id', lesson.id)
    await supabase.from('lessons').insert({ student_id: student.id, scheduled_at: newScheduledAt, duration_minutes: lesson.duration_minutes, status: 'scheduled', is_trial: lesson.is_trial, notes: `Перенесено`, google_event_id: null })
    await send(chatId, `✅ Занятие <b>${student.name}</b> перенесено на ${rescheduleMatch[3]} в ${rescheduleMatch[4]}`)
    return
  }

  // Неизвестный ввод в рамках диалога
  if (state) {
    await send(chatId, '❓ Нажми /menu для главного меню или продолжи ввод.')
    return
  }

  await send(chatId, '❓ Не понял. Нажми /menu для главного меню.', mainMenu())
}

// ──────────────────────────────────────────────
// Data helpers
// ──────────────────────────────────────────────
async function getActiveStudents() {
  const { data } = await supabase.from('students').select('id, name, tariff_type').eq('is_active', true).order('name')
  return data || []
}

async function getStudentById(id: string) {
  const { data } = await supabase.from('students').select('*').eq('id', id).single()
  return data || null
}

async function getLessonsForDate(dateStr: string) {
  const { data } = await supabase
    .from('lessons').select('*, student:students(name)')
    .gte('scheduled_at', `${dateStr}T00:00:00`)
    .lt('scheduled_at', `${dateStr}T23:59:59`)
    .in('status', ['scheduled'])
    .order('scheduled_at')
  return data || []
}

async function getLessonById(id: string) {
  const { data } = await supabase.from('lessons').select('*, student:students(name)').eq('id', id).single()
  return data || null
}

async function findStudent(namePart: string) {
  const { data } = await supabase.from('students').select('*').ilike('name', `%${namePart}%`).eq('is_active', true).order('name').limit(1)
  return data?.[0] || null
}

async function findLesson(studentId: string, datePart: string) {
  const [day, month, year] = datePart.split('.')
  const y = year || new Date().getFullYear().toString()
  const dateStr = `${y}-${month}-${day.padStart(2, '0')}`
  const { data } = await supabase.from('lessons').select('*').eq('student_id', studentId).gte('scheduled_at', `${dateStr}T00:00:00`).lt('scheduled_at', `${dateStr}T23:59:59`).in('status', ['scheduled', 'rescheduled']).limit(1)
  return data?.[0] || null
}

async function getStudentInfo(student: any): Promise<string> {
  let balanceInfo = ''
  if (student.tariff_type === 'per_lesson') {
    const { data: payments } = await supabase.from('payments').select('amount').eq('student_id', student.id)
    const { data: lessons } = await supabase.from('lessons').select('duration_minutes').eq('student_id', student.id).eq('status', 'completed')
    const paid = (payments || []).reduce((s: number, p: any) => s + p.amount, 0)
    const cost = (lessons || []).reduce((s: number, l: any) => s + (l.duration_minutes / 60) * student.price_per_hour, 0)
    const bal = Math.round(paid - cost)
    balanceInfo = `\n${bal >= 0 ? `💚 Переплата: ${bal} ₽` : `🔴 Долг: ${Math.abs(bal)} ₽`}`
  }
  const { data: next } = await supabase.from('lessons').select('scheduled_at').eq('student_id', student.id).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(1).single()
  const nextInfo = next ? `📅 Следующее: ${formatDateTime(next.scheduled_at)}` : '📅 Занятий не запланировано'
  return `👤 <b>${student.name}</b>\nТариф: ${tariffLabelRu(student.tariff_type)} · ${student.price_per_hour} ₽/час${balanceInfo}\n${nextInfo}`
}

async function getTodayText(): Promise<string> {
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()
  const { data: lessons } = await supabase.from('lessons').select('*, student:students(name)').gte('scheduled_at', from).lt('scheduled_at', to).eq('status', 'scheduled').order('scheduled_at')
  if (!lessons?.length) return '📅 Сегодня занятий нет'
  const lines = lessons.map((l: any) => `• ${formatTime(l.scheduled_at)} — <b>${l.student?.name}</b> (${l.duration_minutes} мин)`)
  return `📅 <b>Сегодня (${lessons.length}):</b>\n${lines.join('\n')}`
}

async function getWeekText(): Promise<string> {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString()
  const { data: lessons } = await supabase.from('lessons').select('*, student:students(name)').gte('scheduled_at', from).lt('scheduled_at', to).eq('status', 'scheduled').order('scheduled_at')
  if (!lessons?.length) return '📅 На этой неделе занятий нет'
  const lines = lessons.map((l: any) => `• ${formatDateTime(l.scheduled_at)} — <b>${l.student?.name}</b>`)
  return `📅 <b>Ближайшие 7 дней (${lessons.length}):</b>\n${lines.join('\n')}`
}

async function getDebtsText(): Promise<string> {
  const { data: students } = await supabase.from('students').select('*').eq('is_active', true).eq('tariff_type', 'per_lesson')
  if (!students?.length) return '✅ Должников нет'
  const debtors: string[] = []
  for (const s of students) {
    const { data: payments } = await supabase.from('payments').select('amount').eq('student_id', s.id)
    const { data: lessons } = await supabase.from('lessons').select('duration_minutes').eq('student_id', s.id).eq('status', 'completed')
    const paid = (payments || []).reduce((sum: number, p: any) => sum + p.amount, 0)
    const cost = (lessons || []).reduce((sum: number, l: any) => sum + (l.duration_minutes / 60) * s.price_per_hour, 0)
    const balance = paid - cost
    if (balance < -100) debtors.push(`• <b>${s.name}</b>: ${Math.abs(Math.round(balance))} ₽`)
  }
  return debtors.length ? `💸 <b>Должники:</b>\n${debtors.join('\n')}` : '✅ Должников нет'
}

// ──────────────────────────────────────────────
// Formatting
// ──────────────────────────────────────────────
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
}

function tariffLabelRu(type: string): string {
  return ({ per_lesson: 'По занятию', package: 'Пакет', monthly: 'Помесячно' } as Record<string,string>)[type] || type
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

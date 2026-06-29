-- =============================================
-- Миграция 002: расписание, настройки, блокировки
-- Выполни в Supabase → SQL Editor
-- =============================================

-- Регулярное расписание ученика (0=Пн..6=Вс)
CREATE TABLE IF NOT EXISTS student_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_student_schedules_student ON student_schedules(student_id);
CREATE INDEX IF NOT EXISTS idx_student_schedules_day ON student_schedules(day_of_week);

-- Настройки преподавателя (одна строка)
CREATE TABLE IF NOT EXISTS teacher_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_start TIME NOT NULL DEFAULT '09:00',
  work_end TIME NOT NULL DEFAULT '20:00',
  break_start TIME,
  break_end TIME,
  work_days INT[] NOT NULL DEFAULT '{0,1,2,3,4}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO teacher_settings (work_start, work_end, break_start, break_end, work_days)
SELECT '09:00', '20:00', '12:00', '14:00', '{0,1,2,3,4}'
WHERE NOT EXISTS (SELECT 1 FROM teacher_settings);

-- Личные блокировки (recurring = каждую неделю, one_time = конкретная дата)
CREATE TABLE IF NOT EXISTS blocked_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  slot_type TEXT NOT NULL CHECK (slot_type IN ('recurring', 'one_time')),
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME,
  end_time TIME,
  blocked_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_type ON blocked_slots(slot_type);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_date ON blocked_slots(blocked_date);

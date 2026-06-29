-- =============================================
-- Платформа репетитора английского языка
-- SQL-схема для Supabase
-- Вставь этот скрипт в SQL Editor в Supabase
-- =============================================

-- Расширения
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- УЧЕНИКИ
-- =============================================
CREATE TABLE students (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  phone           TEXT,
  telegram_username TEXT,
  tariff_type     TEXT NOT NULL CHECK (tariff_type IN ('per_lesson', 'package', 'monthly')),
  price_per_hour  NUMERIC(10,2) NOT NULL,
  trial_price     NUMERIC(10,2),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- ЗАНЯТИЯ
-- =============================================
CREATE TABLE lessons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  is_trial        BOOLEAN NOT NULL DEFAULT false,
  google_event_id TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lessons_student_id ON lessons(student_id);
CREATE INDEX idx_lessons_scheduled_at ON lessons(scheduled_at);

-- =============================================
-- ПЛАТЕЖИ
-- =============================================
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL,
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_type    TEXT NOT NULL CHECK (payment_type IN ('per_lesson', 'package', 'monthly', 'trial')),
  lesson_id       UUID REFERENCES lessons(id) ON DELETE SET NULL,
  package_id      UUID,  -- будет внешним ключом после создания packages
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_student_id ON payments(student_id);
CREATE INDEX idx_payments_payment_date ON payments(payment_date);

-- =============================================
-- ПАКЕТЫ ЗАНЯТИЙ
-- =============================================
CREATE TABLE packages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  total_lessons   INT NOT NULL,
  used_lessons    INT NOT NULL DEFAULT 0,
  price_total     NUMERIC(10,2) NOT NULL,
  purchase_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_at      DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Добавляем внешний ключ к payments.package_id
ALTER TABLE payments
  ADD CONSTRAINT fk_payments_package
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL;

-- =============================================
-- ПОМЕСЯЧНЫЕ ПОДПИСКИ
-- =============================================
CREATE TABLE monthly_subscriptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  month           TEXT NOT NULL,  -- формат YYYY-MM, например '2024-06'
  amount          NUMERIC(10,2) NOT NULL,
  lessons_count   INT NOT NULL DEFAULT 0,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, month)
);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- Отключаем RLS — у приложения один пользователь (ты),
-- аутентификации нет. Если хочешь добавить вход — включи RLS.
-- =============================================
ALTER TABLE students DISABLE ROW LEVEL SECURITY;
ALTER TABLE lessons DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE packages DISABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_subscriptions DISABLE ROW LEVEL SECURITY;

-- =============================================
-- ТЕСТОВЫЕ ДАННЫЕ (ОПЦИОНАЛЬНО)
-- Раскомментируй если хочешь начать с примерами
-- =============================================

/*
INSERT INTO students (name, phone, tariff_type, price_per_hour, trial_price, notes) VALUES
  ('Анна Смирнова', '+7 900 111 22 33', 'per_lesson', 2000, 500, 'Intermediate, готовится к IELTS'),
  ('Иван Петров', '+7 900 444 55 66', 'package', 1800, null, 'Elementary, для работы'),
  ('Мария Козлова', null, 'monthly', 2200, 500, 'Upper-Intermediate');

-- Пример пакета для Ивана Петрова
INSERT INTO packages (student_id, total_lessons, used_lessons, price_total, purchase_date)
SELECT id, 10, 3, 18000, CURRENT_DATE FROM students WHERE name = 'Иван Петров';

-- Пример подписки для Марии Козловой
INSERT INTO monthly_subscriptions (student_id, month, amount, lessons_count)
SELECT id, TO_CHAR(CURRENT_DATE, 'YYYY-MM'), 8800, 4 FROM students WHERE name = 'Мария Козлова';
*/

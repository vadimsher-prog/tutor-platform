-- =============================================
-- Миграция 001: контактное лицо, уровень языка, мини-группы
-- Выполни в Supabase → SQL Editor
-- =============================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone    TEXT,
  ADD COLUMN IF NOT EXISTS contact_relation TEXT;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS language_level TEXT
  CHECK (language_level IN ('A1','A2','B1','B2','C1','C2') OR language_level IS NULL);

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS can_group  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_tag  TEXT;

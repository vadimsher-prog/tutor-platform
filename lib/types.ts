export type TariffType = 'per_lesson' | 'package' | 'monthly'
export type LessonStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled'
export type PaymentType = 'per_lesson' | 'package' | 'monthly' | 'trial'

export interface Student {
  id: string
  name: string
  phone: string | null
  telegram_username: string | null
  tariff_type: TariffType
  price_per_hour: number
  trial_price: number | null
  notes: string | null
  is_active: boolean
  created_at: string
}

export interface Lesson {
  id: string
  student_id: string
  student?: Student
  scheduled_at: string
  duration_minutes: number
  status: LessonStatus
  is_trial: boolean
  google_event_id: string | null
  notes: string | null
  created_at: string
}

export interface Payment {
  id: string
  student_id: string
  student?: Student
  amount: number
  payment_date: string
  payment_type: PaymentType
  lesson_id: string | null
  package_id: string | null
  notes: string | null
  created_at: string
}

export interface Package {
  id: string
  student_id: string
  student?: Student
  total_lessons: number
  used_lessons: number
  price_total: number
  purchase_date: string
  expires_at: string | null
  notes: string | null
  created_at: string
}

export interface MonthlySubscription {
  id: string
  student_id: string
  student?: Student
  month: string  // YYYY-MM
  amount: number
  lessons_count: number
  paid_at: string | null
  created_at: string
}

export interface TeacherSettings {
  id: string
  work_start: string
  work_end: string
  break_start: string | null
  break_end: string | null
  work_days: number[]
  updated_at: string
}

export interface BlockedSlot {
  id: string
  label: string
  slot_type: 'recurring' | 'one_time'
  day_of_week: number | null
  start_time: string | null
  end_time: string | null
  blocked_date: string | null
  created_at: string
}

export interface StudentSchedule {
  id: string
  student_id: string
  day_of_week: number
  start_time: string
  duration_minutes: number
  is_active: boolean
  created_at: string
}

// Supabase Database type
export interface Database {
  public: {
    Tables: {
      students: {
        Row: Student
        Insert: Omit<Student, 'id' | 'created_at'>
        Update: Partial<Omit<Student, 'id' | 'created_at'>>
      }
      lessons: {
        Row: Lesson
        Insert: Omit<Lesson, 'id' | 'created_at'>
        Update: Partial<Omit<Lesson, 'id' | 'created_at'>>
      }
      payments: {
        Row: Payment
        Insert: Omit<Payment, 'id' | 'created_at'>
        Update: Partial<Omit<Payment, 'id' | 'created_at'>>
      }
      packages: {
        Row: Package
        Insert: Omit<Package, 'id' | 'created_at'>
        Update: Partial<Omit<Package, 'id' | 'created_at'>>
      }
      monthly_subscriptions: {
        Row: MonthlySubscription
        Insert: Omit<MonthlySubscription, 'id' | 'created_at'>
        Update: Partial<Omit<MonthlySubscription, 'id' | 'created_at'>>
      }
      teacher_settings: {
        Row: TeacherSettings
        Insert: Omit<TeacherSettings, 'id' | 'updated_at'>
        Update: Partial<Omit<TeacherSettings, 'id'>>
      }
      blocked_slots: {
        Row: BlockedSlot
        Insert: Omit<BlockedSlot, 'id' | 'created_at'>
        Update: Partial<Omit<BlockedSlot, 'id' | 'created_at'>>
      }
      student_schedules: {
        Row: StudentSchedule
        Insert: Omit<StudentSchedule, 'id' | 'created_at'>
        Update: Partial<Omit<StudentSchedule, 'id' | 'created_at'>>
      }
    }
  }
}

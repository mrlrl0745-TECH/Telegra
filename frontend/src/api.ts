export type Stage = { stage_name: string; time: string; teacher_actions: string; student_actions: string; resources: string; assessment: string }
export type Lesson = {
  id: string; subject: string; section: string; grade: string; topic: string; lesson_date: string; teacher_name: string
  present_count: number; absent_count: number; learning_objectives: string[]; lesson_objectives: string[]
  content_json: { title: string; language: 'ru' | 'kk'; section: string; teacher_name: string; date: string; subject: string; class_name: string; present_count: number; absent_count: number; lesson_topic: string; learning_objectives: string[]; lesson_objectives: string[]; stages: Stage[]; homework: string; reflection: string }
  language: string; created_at: string; updated_at: string
}
export type Template = { id: string; name: string; file_type: string; template_structure: Record<string, any>; created_at: string }
export type User = { id: string; telegram_user_id: number; first_name: string; last_name: string; free_generations: number; subscription_status: string; subscription_type?: string | null; subscription_end?: string | null; is_admin: boolean; is_blocked: boolean }
export type AdminStats = Record<string, number>
export type Usage = { free_generations: number; free_generations_total: number; subscription_active: boolean; subscription_status: string; subscription_type: string | null; subscription_end: string | null; lessons_created: number }
const base = import.meta.env.VITE_API_URL || 'http://localhost:8000'

try {
  localStorage.removeItem('ksp_token')
  localStorage.removeItem('ksp_draft')
} catch { /* Storage may be disabled by the host browser. */ }
let token = ''
try { token = sessionStorage.getItem('ksp_token') || '' } catch { /* Keep the token in memory only. */ }
export function setToken(value: string) {
  token = value
  try {
    if (value) sessionStorage.setItem('ksp_token', value)
    else sessionStorage.removeItem('ksp_token')
  } catch { /* The in-memory token remains usable for this page. */ }
}
export function getToken() { return token }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${base}${path}`, { ...options, headers })
  if (!response.ok) {
    let message = 'Не удалось выполнить запрос'
    try { const data = await response.json(); message = data.detail || message } catch { /* Keep safe fallback. */ }
    const error = new Error(message) as Error & { status: number }
    error.status = response.status
    throw error
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export const api = {
  authTelegram: (init_data: string) => request<{ access_token: string; user: User }>('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ init_data }) }),
  authDev: () => request<{ access_token: string; user: User }>('/api/auth/dev', { method: 'POST' }),
  me: () => request<User>('/api/users/me'),
  usage: () => request<Usage>('/api/users/usage'),
  lessons: () => request<Lesson[]>('/api/lessons'),
  lesson: (id: string) => request<Lesson>(`/api/lessons/${id}`),
  generate: (data: Record<string, unknown>) => request<Lesson>('/api/lessons/generate', { method: 'POST', body: JSON.stringify(data) }),
  updateLesson: (id: string, data: Lesson['content_json']) => request<Lesson>(`/api/lessons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  regenerate: (id: string) => request<Lesson>(`/api/lessons/${id}/regenerate`, { method: 'POST' }),
  deleteLesson: (id: string) => request<{ ok: boolean }>(`/api/lessons/${id}`, { method: 'DELETE' }),
  copyLesson: (id: string) => request<Lesson>(`/api/lessons/${id}/copy`, { method: 'POST' }),
  templates: () => request<Template[]>('/api/templates'),
  uploadTemplate: (name: string, file: File) => { const data = new FormData(); data.append('name', name); data.append('file', file); return request<Template>('/api/templates', { method: 'POST', body: data }) },
  deleteTemplate: (id: string) => request<{ ok: boolean }>(`/api/templates/${id}`, { method: 'DELETE' }),
  subscription: () => request<{ active: boolean; status: string; type: string | null; end_date: string | null; tariffs: { type: string; price: number; currency: string }[] }>('/api/subscription'),
  createPayment: (tariff: 'monthly' | 'yearly') => request<{ id: string; amount: number; currency: string; status: string; tariff: string }>('/api/payments/create', { method: 'POST', body: JSON.stringify({ tariff }) }),
  simulatePayment: (id: string, status: string) => request<{ id: string; status: string }>(`/api/payments/${id}/simulate?status=${status}`, { method: 'POST' }),
  adminStats: () => request<AdminStats>('/api/admin/statistics'),
  adminUsers: () => request<User[]>('/api/admin/users'),
  adminUser: (id: string) => request<{ user: User; payments: { id: string; amount: number; currency: string; status: string; tariff: string; created_at: string }[]; subscriptions: { id: string; type: string; status: string; start_date: string | null; end_date: string | null }[] }>(`/api/admin/users/${id}`),
  adminPayments: () => request<{ id: string; amount: number; currency: string; status: string; tariff: string; created_at: string }[]>('/api/admin/payments'),
  adminCredits: (id: string, amount = 3) => request(`/api/admin/users/${id}/credits`, { method: 'POST', body: JSON.stringify({ amount }) }),
  adminBlock: (id: string, blocked: boolean) => request(`/api/admin/users/${id}/block`, { method: 'PUT', body: JSON.stringify({ blocked }) }),
  adminSubscription: (id: string, type: 'monthly' | 'yearly') => request(`/api/admin/users/${id}/subscription`, { method: 'POST', body: JSON.stringify({ type }) }),
  async exportDocx(id: string) {
    const response = await fetch(`${base}/api/lessons/${id}/export/docx`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) throw new Error('Не удалось скачать DOCX')
    return response.blob()
  },
  async exportPdf(id: string) {
    const response = await fetch(`${base}/api/lessons/${id}/export/pdf`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) throw new Error('Не удалось скачать PDF')
    return response.blob()
  },
}

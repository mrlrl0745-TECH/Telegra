import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, AdminStats, getToken, Lesson, Stage, Template, Usage, User, setToken } from './api'

declare global { interface Window { Telegram?: { WebApp?: any } } }
type View = 'home' | 'wizard' | 'lessons' | 'templates' | 'tariff' | 'help' | 'preview' | 'admin'
type Language = 'ru' | 'kk'
type AdminPayment = { id: string; amount: number; currency: string; status: string; tariff: string; created_at: string }
type AdminDetail = { user: User; payments: AdminPayment[]; subscriptions: { id: string; type: string; status: string; start_date: string | null; end_date: string | null }[] }
type FormData = {
  teacher_name: string; lesson_date: string; subject: string; section: string; grade: string; present_count: number; absent_count: number; topic: string
  learning_objectives: string[]; lesson_objectives: string[]; lesson_duration: number; lesson_type: string; class_level: string; students_count: number
  language: Language; difficulty: string; work_formats: string[]; pair_work: boolean; group_work: boolean; individual_work: boolean; differentiation: boolean
  homework_required: boolean; reflection_required: boolean; interactive_tasks: boolean; additional_requirements: string; template_id: string | null
}

const initialForm: FormData = { teacher_name: '', lesson_date: new Date().toISOString().slice(0, 10), subject: '', section: '', grade: '', present_count: 0, absent_count: 0, topic: '', learning_objectives: [''], lesson_objectives: [''], lesson_duration: 45, lesson_type: 'Комбинированный урок', class_level: 'Средний', students_count: 0, language: 'ru', difficulty: 'Средний', work_formats: [], pair_work: false, group_work: false, individual_work: true, differentiation: false, homework_required: true, reflection_required: true, interactive_tasks: false, additional_requirements: '', template_id: null }
const copy = {
  ru: { create: 'Создать КСП', mine: 'Мои КСП', templates: 'Мои шаблоны', tariff: 'Мой тариф', help: 'Помощь', remaining: 'Бесплатных генераций', activeUntil: 'Подписка активна до', subtitle: 'Готовый поурочный план по вашему шаблону — за несколько минут.', start: 'Начать создание', welcome: 'Добро пожаловать', step: 'Шаг', back: 'Назад', next: 'Далее', generate: 'Сформировать КСП', generating: 'Формируем ваш план…', standard: 'Стандартный шаблон', upload: 'Загрузить свой шаблон', save: 'Сохранить изменения', download: 'Скачать DOCX', regenerate: 'Создать другой вариант', empty: 'Пока нет сохранённых КСП', close: 'Закрыть', cancel: 'Отмена', preview: 'Предпросмотр', subscribe: 'Выбрать тариф', language: 'Язык КСП' },
  kk: { create: 'ҚМЖ құру', mine: 'Менің ҚМЖ-ларым', templates: 'Менің үлгілерім', tariff: 'Менің тарифім', help: 'Көмек', remaining: 'Тегін генерация қалды', activeUntil: 'Жазылым мерзімі', subtitle: 'Үлгіңізге сай дайын сабақ жоспары — бірнеше минутта.', start: 'Құруды бастау', welcome: 'Қош келдіңіз', step: 'Қадам', back: 'Артқа', next: 'Келесі', generate: 'ҚМЖ жасау', generating: 'Жоспар жасалуда…', standard: 'Стандартты үлгі', upload: 'Үлгі жүктеу', save: 'Өзгерістерді сақтау', download: 'DOCX жүктеу', regenerate: 'Басқа нұсқа жасау', empty: 'Сақталған ҚМЖ жоқ', close: 'Жабу', cancel: 'Бас тарту', preview: 'Алдын ала көру', language: 'ҚМЖ тілі', subscribe: 'Тариф таңдау' },
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Не удалось выполнить запрос' }
function defaultContent(lesson: Lesson): Lesson['content_json'] { return structuredClone(lesson.content_json) }

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [view, setView] = useState<View>('home')
  const [language, setLanguage] = useState<Language>('ru')
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [adminUsers, setAdminUsers] = useState<User[]>([])
  const [adminPayments, setAdminPayments] = useState<AdminPayment[]>([])
  const [adminDetail, setAdminDetail] = useState<AdminDetail | null>(null)
  const [active, setActive] = useState<Lesson | null>(null)
  const [content, setContent] = useState<Lesson['content_json'] | null>(null)
  const [form, setForm] = useState<FormData>(initialForm)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const [resumeDraft, setResumeDraft] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const t = copy[language]
  const wizardTitles = language === 'kk' ? ['Сабақ туралы мәлімет', 'Оқу мақсаттары', 'Сабақ параметрлері', 'Қосымша талаптар', 'Тексеру және құру'] : ['Данные урока', 'Цели обучения', 'Параметры урока', 'Дополнительные пожелания', 'Проверка и генерация']

  const refresh = useCallback(async () => {
    const [currentUser, currentUsage, userLessons, userTemplates] = await Promise.all([api.me(), api.usage(), api.lessons(), api.templates()])
    setUser(currentUser); setUsage(currentUsage); setLessons(userLessons); setTemplates(userTemplates)
  }, [])

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    webApp?.ready?.(); webApp?.expand?.()
    const theme = webApp?.themeParams || {}
    if (theme.button_color) document.documentElement.style.setProperty('--tg-button-color', theme.button_color)
    if (theme.button_text_color) document.documentElement.style.setProperty('--tg-button-text-color', theme.button_text_color)
    if (theme.bg_color) webApp?.setBackgroundColor?.(theme.bg_color)
    if (theme.header_bg_color || theme.bg_color) webApp?.setHeaderColor?.(theme.header_bg_color || theme.bg_color)
    const initData = webApp?.initData
    const login = async () => {
      try {
        if (!getToken()) {
          if (initData) { const response = await api.authTelegram(initData); setToken(response.access_token) }
          else if (import.meta.env.VITE_DEV_MODE === 'true') { const response = await api.authDev(); setToken(response.access_token) }
          else { setError('Откройте приложение из Telegram, чтобы войти.'); return }
        }
        await refresh()
      } catch (e) { setToken(''); setError(errorMessage(e)) }
    }
    void login()
  const draft = sessionStorage.getItem('ksp_draft')
    if (draft) setResumeDraft(true)
  }, [refresh])

  useEffect(() => {
    if (form.language !== language) {
      const types = [['Комбинированный урок', 'Аралас сабақ'], ['Изучение нового материала', 'Жаңа тақырыпты меңгеру'], ['Закрепление', 'Бекіту'], ['Повторение', 'Қайталау'], ['Контроль знаний', 'Білімді бақылау'], ['Практическая работа', 'Практикалық жұмыс']]
      const levels = [['Начальный', 'Бастапқы'], ['Средний', 'Орташа'], ['Продвинутый', 'Жоғары'], ['Смешанный', 'Аралас']]
      const difficulties = [['Базовый', 'Негізгі'], ['Средний', 'Орташа'], ['Повышенный', 'Жоғары']]
      const index = language === 'kk' ? 1 : 0
      setForm((value) => ({
        ...value, language,
        lesson_type: types.find((pair) => pair.includes(value.lesson_type))?.[index] || value.lesson_type,
        class_level: levels.find((pair) => pair.includes(value.class_level))?.[index] || value.class_level,
        difficulty: difficulties.find((pair) => pair.includes(value.difficulty))?.[index] || value.difficulty,
      }))
    }
  }, [language, form.language])
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer) } }, [toast])

  const startWizard = (keepDraft = false) => {
    if (keepDraft) {
      try { const saved = JSON.parse(sessionStorage.getItem('ksp_draft') || '{}'); setForm({ ...initialForm, ...saved.form }); setStep(saved.step || 0) } catch { setForm(initialForm) }
    } else { setForm(initialForm); setStep(0); sessionStorage.removeItem('ksp_draft') }
    setError(''); setView('wizard'); setResumeDraft(false)
  }
  const updateForm = <K extends keyof FormData>(key: K, value: FormData[K]) => setForm((previous) => ({ ...previous, [key]: value }))
  const nextStep = () => {
    if (step === 0 && (!form.teacher_name.trim() || !form.subject.trim() || !form.grade.trim() || !form.topic.trim())) { setError('Заполните ФИО, предмет, класс и тему урока.'); return }
    if (step === 1 && (!form.learning_objectives.some((x) => x.trim()) || !form.lesson_objectives.some((x) => x.trim()))) { setError('Добавьте хотя бы одну цель обучения и цель урока.'); return }
    setError(''); setStep((n) => Math.min(4, n + 1))
  }
  const saveDraft = () => { sessionStorage.setItem('ksp_draft', JSON.stringify({ form, step })); setToast('Черновик сохранён') }
  const generate = async (event?: FormEvent) => {
    event?.preventDefault(); setBusy(true); setError('')
    try {
      const generated = await api.generate({ ...form, learning_objectives: form.learning_objectives.filter(Boolean), lesson_objectives: form.lesson_objectives.filter(Boolean) })
      setActive(generated); setContent(defaultContent(generated)); setView('preview'); sessionStorage.removeItem('ksp_draft'); await refresh()
    } catch (e) { setError(errorMessage(e)); if ((e as any)?.status === 402) setView('tariff') }
    finally { setBusy(false) }
  }
  const openLesson = async (lesson: Lesson) => { setActive(lesson); setContent(defaultContent(lesson)); setView('preview'); setError('') }
  const saveLesson = async () => {
    if (!active || !content) return
    setBusy(true); setError('')
    try { const updated = await api.updateLesson(active.id, content); setActive(updated); setContent(updated.content_json); await refresh(); setToast('Изменения сохранены') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const download = async (lesson: Lesson) => {
    try { const blob = await api.exportDocx(lesson.id); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `ksp-${lesson.topic.slice(0, 45).replace(/[^\p{L}\p{N}-]+/gu, '-')}.docx`; a.click(); URL.revokeObjectURL(href) }
    catch (e) { setError(errorMessage(e)) }
  }
  const downloadPdf = async (lesson: Lesson) => {
    try { const blob = await api.exportPdf(lesson.id); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `ksp-${lesson.topic.slice(0, 45).replace(/[^\p{L}\p{N}-]+/gu, '-')}.pdf`; a.click(); URL.revokeObjectURL(href) }
    catch (e) { setError(errorMessage(e)) }
  }
  const regenerate = async () => {
    if (!active) return
    setBusy(true); setError('')
    try { const updated = await api.regenerate(active.id); setActive(updated); setContent(updated.content_json); await refresh(); setToast('Новый вариант готов') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const createPayment = async (tariff: 'monthly' | 'yearly') => {
    setBusy(true); setError('')
    try { const payment = await api.createPayment(tariff); setPaymentId(payment.id); setToast('Тестовый платёж создан') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const refreshAdmin = async () => {
    setBusy(true); setError('')
    try { const [stats, people, payments] = await Promise.all([api.adminStats(), api.adminUsers(), api.adminPayments()]); setAdminStats(stats); setAdminUsers(people); setAdminPayments(payments) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const adminAction = async (action: () => Promise<unknown>) => {
    try { await action(); await refreshAdmin(); await refresh(); setToast('Данные обновлены') }
    catch (e) { setError(errorMessage(e)) }
  }
  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); setError('')
    try { const item = await api.uploadTemplate(templateName || file.name.replace(/\.[^.]+$/, ''), file); setTemplates((list) => [item, ...list]); setTemplateName(''); setToast('Шаблон сохранён') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false); event.target.value = '' }
  }
  const chooseDownload = (lesson: Lesson) => void download(lesson)
  const due = usage?.subscription_end ? new Date(usage.subscription_end).toLocaleDateString(language === 'kk' ? 'kk-KZ' : 'ru-RU') : ''

  if (!user) return <main className="auth-shell"><div className="brand-mark">К</div><h1>КСП Генератор</h1><p>{error || 'Подключаем защищённую сессию…'}</p>{error && <button className="button primary" onClick={() => window.location.reload()}>Попробовать снова</button>}</main>

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setView('home')} aria-label="На главную"><span className="brand-mark">К</span><span>КСП Генератор</span></button><div className="top-actions"><div className="lang-switch"><button className={language === 'ru' ? 'selected' : ''} onClick={() => setLanguage('ru')}>RU</button><button className={language === 'kk' ? 'selected' : ''} onClick={() => setLanguage('kk')}>KZ</button></div><span className="avatar">{(user.first_name || 'У').slice(0, 1).toUpperCase()}</span></div></header>
    <main className="content">
      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть">×</button></div>}
      {view === 'home' && <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow">ПЛАН УРОКА · КАЗАХСТАН</div><h1>{t.welcome},<br />{user.first_name || 'учитель'}!</h1><p>{t.subtitle}</p><button className="button primary large" onClick={() => startWizard()}><span className="plus">＋</span>{t.start}<span>→</span></button></div><div className="hero-art" aria-hidden="true"><div className="paper"><div className="paper-line short"/><div className="paper-line"/><div className="paper-row"><i/><i/><i/></div><div className="paper-line"/><div className="paper-row"><i/><i/><i/></div><div className="paper-line short"/><div className="paper-check">✓</div></div><div className="sparkle s1">✳</div><div className="sparkle s2">✦</div></div></section>
        <section className="usage-card"><div><span className="usage-icon">✦</span><div><strong>{usage?.subscription_active ? `${t.activeUntil} ${due}` : t.remaining}</strong><small>{usage?.subscription_active ? (usage.subscription_type === 'yearly' ? 'Годовой тариф' : 'Месячный тариф') : `${usage?.free_generations ?? 0} из ${usage?.free_generations_total ?? 3} доступно`}</small></div></div><div className="usage-side"><div className="meter"><span style={{ width: usage?.subscription_active ? '100%' : `${Math.max(0, ((usage?.free_generations ?? 0) / (usage?.free_generations_total || 3)) * 100)}%` }}/></div><button className="text-button" onClick={() => setView('tariff')}>{t.subscribe} <span>→</span></button></div></section>
        <section className="section-heading"><div><div className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</div><h2>Всё для урока</h2></div><span className="muted">{usage?.lessons_created ?? 0} документов</span></section>
        <section className="home-grid">
          <button className="nav-card create-card" onClick={() => startWizard()}><span className="card-icon blue">✦</span><span className="card-copy"><b>{t.create}</b><small>Создайте новый план по шагам</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('lessons')}><span className="card-icon lavender">▤</span><span className="card-copy"><b>{t.mine}</b><small>{usage?.lessons_created ?? 0} сохранённых планов</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('templates')}><span className="card-icon mint">▧</span><span className="card-copy"><b>{t.templates}</b><small>Ваши форматы документов</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('tariff')}><span className="card-icon peach">◇</span><span className="card-copy"><b>{t.tariff}</b><small>Тарифы и история оплаты</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('help')}><span className="card-icon gray">?</span><span className="card-copy"><b>{t.help}</b><small>Как подготовить КСП</small></span><span className="card-arrow">↗</span></button>
          {user.is_admin && <button className="nav-card" onClick={() => { setView('admin'); void refreshAdmin() }}><span className="card-icon gray">⚙</span><span className="card-copy"><b>Администрирование</b><small>Статистика и пользователи</small></span><span className="card-arrow">↗</span></button>}
        </section>
        <footer className="footer-note"><span>✳</span> Создано для учителей Казахстана <span className="footer-dot"/> Ваши планы всегда под рукой</footer>
      </>}

      {view === 'wizard' && <section className="panel wizard-panel">
        <div className="panel-top"><button className="back-link" onClick={() => setView('home')}>← Главная</button><button className="text-button" onClick={saveDraft}>Сохранить черновик</button></div>
        <div className="wizard-title"><div className="eyebrow">{language === 'kk' ? 'ҚМЖ ЖАСАУ' : 'СОЗДАНИЕ КСП'}</div><h1>{wizardTitles[step]}</h1><p>{t.step} {step + 1} / 5 <span>·</span> {language === 'kk' ? 'Жоспар сабаққа сай болуы үшін өрістерді толтырыңыз' : 'Заполните поля, чтобы план точно подошёл вашему уроку'}</p></div>
        <div className="progress"><span style={{ width: `${(step + 1) * 20}%` }}/></div>
        <form onSubmit={generate}>
          {step === 0 && <div className="form-grid">
            <Field label={language === 'kk' ? 'Педагогтің аты-жөні' : 'ФИО педагога'}><input value={form.teacher_name} onChange={(e) => updateForm('teacher_name', e.target.value)} placeholder={language === 'kk' ? 'Мысалы, Айгүл Сағындық' : 'Например, Айгуль Сагындык'} required /></Field>
            <Field label={language === 'kk' ? 'Сабақ күні' : 'Дата урока'}><input type="date" value={form.lesson_date} onChange={(e) => updateForm('lesson_date', e.target.value)} required /></Field>
            <Field label={language === 'kk' ? 'Пән' : 'Предмет'}><input value={form.subject} onChange={(e) => updateForm('subject', e.target.value)} placeholder={language === 'kk' ? 'Мысалы, математика' : 'Например, математика'} required /></Field>
            <Field label={language === 'kk' ? 'Бөлім' : 'Раздел'}><input value={form.section} onChange={(e) => updateForm('section', e.target.value)} placeholder={language === 'kk' ? 'Оқу бағдарламасының бөлімі' : 'Раздел учебной программы'} required /></Field>
            <Field label={language === 'kk' ? 'Сынып' : 'Класс'}><input value={form.grade} onChange={(e) => updateForm('grade', e.target.value)} placeholder={language === 'kk' ? 'Мысалы, 7А' : 'Например, 7А'} required /></Field>
            <div className="field-pair"><Field label={language === 'kk' ? 'Қатысқандар' : 'Присутствуют'}><input type="number" min="0" value={form.present_count} onChange={(e) => updateForm('present_count', Number(e.target.value))} /></Field><Field label={language === 'kk' ? 'Қатыспағандар' : 'Отсутствуют'}><input type="number" min="0" value={form.absent_count} onChange={(e) => updateForm('absent_count', Number(e.target.value))} /></Field></div>
            <Field label={language === 'kk' ? 'Сабақ тақырыбы' : 'Тема урока'} className="full"><input value={form.topic} onChange={(e) => updateForm('topic', e.target.value)} placeholder={language === 'kk' ? 'Сабақтың нақты тақырыбын көрсетіңіз' : 'Укажите точную тему урока'} required /></Field>
            <Field label={language === 'kk' ? 'ҚМЖ үлгісі' : 'Шаблон КСП'} className="full"><select value={form.template_id || ''} onChange={(e) => updateForm('template_id', e.target.value || null)}><option value="">{t.standard}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small className="hint">{language === 'kk' ? 'DOCX құрылымы үлгі бланкке сәйкес жасалады.' : 'Структура DOCX будет оформлена по бланку из примера.'}</small></Field>
          </div>}
          {step === 1 && <div className="objective-columns"><ObjectiveEditor number="01" title={language === 'kk' ? 'Оқу бағдарламасындағы мақсаттар' : 'Цели обучения по программе'} helper={language === 'kk' ? 'Оқу бағдарламасындағы мақсаттарды енгізіңіз — жүйе олардың мәтінін өзгертпейді.' : 'Вставьте цели из учебной программы — система сохранит их формулировки.'} values={form.learning_objectives} onChange={(v) => updateForm('learning_objectives', v)} /><ObjectiveEditor number="02" title={language === 'kk' ? 'Сабақ мақсаттары' : 'Цели урока'} helper={language === 'kk' ? 'Оқушылар сабақ соңында нені білуі немесе істей алуы керек?' : 'Что ученики должны знать или уметь к концу занятия?'} values={form.lesson_objectives} onChange={(v) => updateForm('lesson_objectives', v)} /></div>}
          {step === 2 && <div className="form-grid"><Field label={language === 'kk' ? 'Сабақ ұзақтығы' : 'Продолжительность урока'}><select value={form.lesson_duration} onChange={(e) => updateForm('lesson_duration', Number(e.target.value))}>{[40, 45, 50, 60, 80].map((n) => <option key={n} value={n}>{n} минут</option>)}</select></Field><Field label={language === 'kk' ? 'Сабақ түрі' : 'Тип урока'}><select value={form.lesson_type} onChange={(e) => updateForm('lesson_type', e.target.value)}>{(language === 'kk' ? ['Аралас сабақ', 'Жаңа тақырыпты меңгеру', 'Бекіту', 'Қайталау', 'Білімді бақылау', 'Практикалық жұмыс'] : ['Комбинированный урок', 'Изучение нового материала', 'Закрепление', 'Повторение', 'Контроль знаний', 'Практическая работа']).map((x) => <option key={x}>{x}</option>)}</select></Field><Field label={language === 'kk' ? 'Сынып деңгейі' : 'Уровень класса'}><select value={form.class_level} onChange={(e) => updateForm('class_level', e.target.value)}>{(language === 'kk' ? ['Бастапқы', 'Орташа', 'Жоғары', 'Аралас'] : ['Начальный', 'Средний', 'Продвинутый', 'Смешанный']).map((x) => <option key={x}>{x}</option>)}</select></Field><Field label={language === 'kk' ? 'Оқушылар саны' : 'Количество учащихся'}><input type="number" min="0" value={form.students_count} onChange={(e) => updateForm('students_count', Number(e.target.value))} /></Field><Field label={language === 'kk' ? 'Күрделілік' : 'Сложность'}><select value={form.difficulty} onChange={(e) => updateForm('difficulty', e.target.value)}>{(language === 'kk' ? ['Негізгі', 'Орташа', 'Жоғары'] : ['Базовый', 'Средний', 'Повышенный']).map((x) => <option key={x}>{x}</option>)}</select></Field><Field label={t.language}><select value={language} onChange={(e) => setLanguage(e.target.value as Language)}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></Field><div className="field full"><label>{language === 'kk' ? 'Жұмыс түрлері' : 'Формы работы'}</label><div className="chip-row">{[['Фронтальная', 'Жалпы сыныппен'], ['Парная', 'Жұптық'], ['Групповая', 'Топтық'], ['Индивидуальная', 'Жеке']].map(([name, label]) => <button type="button" key={name} className={`choice-chip ${form.work_formats.includes(name) ? 'checked' : ''}`} onClick={() => updateForm('work_formats', form.work_formats.includes(name) ? form.work_formats.filter((x) => x !== name) : [...form.work_formats, name])}>{form.work_formats.includes(name) ? '✓ ' : '+ '}{language === 'kk' ? label : name}</button>)}</div></div></div>}
          {step === 3 && <div className="preferences"><div className="pref-intro"><span className="card-icon blue">✳</span><div><b>{language === 'kk' ? 'Сабақты жоспарлағанда нені ескеру керек?' : 'Что учесть при подготовке?'}</b><p>{language === 'kk' ? 'Қажетті нұсқаларды белгілеңіз. Генератор сабақ құрылымын таңдауларыңызға сай жасайды.' : 'Отметьте подходящие варианты. Генератор подберёт структуру урока с учётом ваших решений.'}</p></div></div><div className="check-grid">{([["pair_work", language === 'kk' ? 'Жұптық жұмыс' : 'Работа в парах'], ["group_work", language === 'kk' ? 'Топтық жұмыс' : 'Групповая работа'], ["individual_work", language === 'kk' ? 'Жеке жұмыс' : 'Индивидуальная работа'], ["differentiation", language === 'kk' ? 'Сараланған тапсырмалар' : 'Дифференциация заданий'], ["homework_required", language === 'kk' ? 'Үй тапсырмасы' : 'Домашнее задание'], ["reflection_required", language === 'kk' ? 'Сабақ соңындағы рефлексия' : 'Рефлексия в конце урока'], ["interactive_tasks", language === 'kk' ? 'Интерактивті тапсырмалар' : 'Интерактивные задания']] as const).map(([key, label]) => <label className="check-option" key={key}><input type="checkbox" checked={form[key]} onChange={(e) => updateForm(key, e.target.checked)} /><span className="check-custom">✓</span><span>{label}</span></label>)}</div><Field label={language === 'kk' ? 'Қосымша тілектер' : 'Дополнительные пожелания'} className="full"><textarea maxLength={3000} rows={5} value={form.additional_requirements} onChange={(e) => updateForm('additional_requirements', e.target.value)} placeholder={language === 'kk' ? 'Осы сабаққа арналған арнайы талаптар, материалдар немесе екпіндер' : 'Особые условия, материалы или акценты для этого урока'} /></Field></div>}
          {step === 4 && <div className="review"><div className="review-top"><div><div className="eyebrow">ПРОВЕРЬТЕ ДАННЫЕ</div><h2>{form.topic || 'Тема урока'}</h2><p>{form.subject} · {form.grade} класс · {form.lesson_duration} минут</p></div><button type="button" className="text-button" onClick={() => setStep(0)}>Изменить</button></div><div className="review-grid"><Review label="Педагог" value={form.teacher_name}/><Review label="Дата" value={form.lesson_date}/><Review label="Раздел" value={form.section}/><Review label="Посещаемость" value={`${form.present_count} присутствуют · ${form.absent_count} отсутствуют`}/><Review label="Цели по программе" value={form.learning_objectives.filter(Boolean).join(' · ')}/><Review label="Цели урока" value={form.lesson_objectives.filter(Boolean).join(' · ')}/></div><div className="privacy-note"><span>✦</span><span>{language === 'kk' ? 'Сабақ параметрлері, оқу мақсаттары және жүктелген үлгінің алынған құрылымы таңдалған AI провайдеріне жіберіледі. Оқушылардың жеке деректерін қоспаңыз.' : 'Параметры урока, цели и извлечённая структура шаблона отправляются выбранному AI-провайдеру. Не добавляйте персональные данные учеников.'}</span></div></div>}
          {error && <div className="inline-error">{error}</div>}
          <div className="wizard-footer">{step > 0 ? <button type="button" className="button secondary" onClick={() => { setStep((s) => s - 1); setError('') }}>{t.back}</button> : <button type="button" className="button secondary" onClick={() => setView('home')}>{t.cancel}</button>}{step < 4 ? <button type="button" className="button primary" onClick={nextStep}>{t.next}<span>→</span></button> : <button type="submit" className="button primary" disabled={busy}>{busy ? <><span className="spinner"/>{t.generating}</> : <>{t.generate}<span>✦</span></>}</button>}</div>
        </form>
      </section>}

      {view === 'preview' && active && content && <section className="panel preview-panel"><div className="panel-top"><button className="back-link" onClick={() => setView('lessons')}>← {t.mine}</button><span className="saved-pill">● Сохранено</span></div><div className="preview-head"><div><div className="eyebrow">{t.preview}</div><h1>{content.lesson_topic}</h1><p>{content.subject} · {content.class_name} класс · {content.date}</p></div><div className="preview-actions"><button className="button secondary" onClick={regenerate} disabled={busy}>{busy ? <span className="spinner"/> : '↻'} {t.regenerate}{usage?.subscription_active ? '' : ' · −1'}</button><button className="button primary" onClick={() => void download(active)}>DOCX <span>↓</span></button><button className="button secondary" onClick={() => void downloadPdf(active)}>PDF <span>↓</span></button></div></div><KspEditor content={content} onChange={setContent} /><div className="edit-footer"><span>Изменения сохраняются в ваших КСП.</span><button className="button primary" onClick={() => void saveLesson()} disabled={busy}>{busy ? 'Сохраняем…' : t.save}</button></div>{error && <div className="inline-error">{error}</div>}</section>}

      {view === 'lessons' && <section className="page-section"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ВАША БИБЛИОТЕКА</div><h1>{t.mine}</h1><p>Все созданные планы в одном месте.</p></div><button className="button primary" onClick={() => startWizard()}>{t.create}<span>＋</span></button></div>{lessons.length ? <div className="lesson-list">{lessons.map((lesson) => <article className="lesson-card" key={lesson.id}><div className="lesson-symbol">▤</div><div className="lesson-details"><span className="eyebrow">{lesson.subject} · {lesson.grade} КЛАСС</span><h3>{lesson.topic}</h3><p>{lesson.lesson_date} <i/> {new Date(lesson.created_at).toLocaleDateString()}</p></div><div className="lesson-buttons"><button onClick={() => void openLesson(lesson)}>Открыть</button><button onClick={() => chooseDownload(lesson)}>DOCX ↓</button><button aria-label="Ещё" onClick={async () => { try { await api.copyLesson(lesson.id); await refresh(); setToast('Копия создана') } catch (e) { setError(errorMessage(e)) } }}>Копия</button><button className="danger-text" onClick={async () => { if (window.confirm('Удалить этот КСП?')) { await api.deleteLesson(lesson.id); await refresh() } }}>Удалить</button></div></article>)}</div> : <div className="empty-state"><span className="empty-icon">▤</span><h2>{t.empty}</h2><p>Создайте первый план, и он останется в вашей библиотеке.</p><button className="button primary" onClick={() => startWizard()}>{t.start}<span>→</span></button></div>}</section>}

      {view === 'templates' && <section className="page-section"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ПЕРСОНАЛЬНЫЕ ФОРМАТЫ</div><h1>{t.templates}</h1><p>Сохраните школьный бланк и выберите его при создании КСП.</p></div></div><div className="upload-panel"><div className="upload-icon">↑</div><div><h2>Добавить шаблон</h2><p>DOCX, PDF, PNG или JPG · до 10 МБ</p></div><div className="upload-fields"><input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Название шаблона"/><label className={`button primary upload-button ${busy ? 'disabled' : ''}`}>{busy ? 'Загружаем…' : 'Выбрать файл'}<input type="file" accept=".docx,.pdf,.png,.jpg,.jpeg" onChange={handleUpload} disabled={busy}/></label></div></div><div className="notice"><b>Анализ формата</b><span>Для DOCX извлекаются текстовые блоки и таблицы, для PDF — текстовый слой. Шаблон передаётся AI как контекст, но файл экспорта пока оформляется по стандартному бланку. OCR изображений и ручное сопоставление полей будут добавлены позже.</span></div>{templates.length > 0 && <div className="template-list">{templates.map((item) => <article className="template-card" key={item.id}><span className="template-icon">▧</span><div><b>{item.name}</b><small>{item.file_type.toUpperCase()} · {item.template_structure?.analysis_status === 'extracted' ? `${item.template_structure.tables?.length || 0} таблиц обнаружено` : 'загружен'}</small></div><button className="danger-text" onClick={async () => { if (confirm('Удалить шаблон?')) { await api.deleteTemplate(item.id); setTemplates((list) => list.filter((x) => x.id !== item.id)) } }}>Удалить</button></article>)}</div>}</section>}

      {view === 'admin' && <section className="page-section admin-page"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ЗАЩИЩЁННЫЙ РАЗДЕЛ</div><h1>Администрирование</h1><p>Показатели работы, пользователи, подписки и платежи.</p></div><button className="button secondary" onClick={() => void refreshAdmin()} disabled={busy}>{busy ? 'Обновляем…' : 'Обновить ↻'}</button></div>{adminStats ? <div className="admin-stats">{[["Пользователи", adminStats.users_total, `Новые сегодня: ${adminStats.users_new_today}`], ["Активны за 30 дней", adminStats.users_active_30d, `Заблокировано: ${adminStats.users_blocked}`], ["Генерации", adminStats.generations_total, `Сегодня: ${adminStats.generations_today} · месяц: ${adminStats.generations_month}`], ["Бесплатные / платные", `${adminStats.generations_free} / ${adminStats.generations_paid}`, `КСП всего: ${adminStats.lessons_total}`], ["Подписки", adminStats.active_subscriptions, `Месячные: ${adminStats.monthly_subscriptions} · годовые: ${adminStats.yearly_subscriptions}`], ["Платежи", `${adminStats.payments_success} успешных`, `Ожидают: ${adminStats.payments_pending} · ошибка: ${adminStats.payments_failed}`], ["Сумма успешных", `${adminStats.payments_amount} ₸`, "KZT"], ["AI-запросы", adminStats.ai_requests, `Ошибки: ${adminStats.ai_errors} · токены: ${(adminStats.ai_prompt_tokens + adminStats.ai_completion_tokens).toLocaleString()}`], ["Стоимость AI", `${adminStats.ai_cost.toFixed(4)}`, "OpenRouter"]].map(([title, value, detail]) => <article className="admin-stat" key={String(title)}><small>{title}</small><b>{value}</b><span>{detail}</span></article>)}</div> : <div className="empty-state"><p>Нажмите «Обновить», чтобы загрузить административные данные.</p><button className="button primary" onClick={() => void refreshAdmin()}>Загрузить сводку</button></div>}
        <div className="admin-section-title"><div><div className="eyebrow">АККАУНТЫ</div><h2>Пользователи</h2></div><span className="muted">{adminUsers.length} записей</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Пользователь / Telegram ID</th><th>Бесплатные</th><th>Подписка</th><th>Управление</th></tr></thead><tbody>{adminUsers.map((person) => <tr key={person.id}><td><b>{[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Пользователь'}</b><small>{person.telegram_user_id}{person.is_admin ? ' · администратор' : ''}</small></td><td>{person.free_generations}</td><td>{person.subscription_status === 'active' ? `${person.subscription_type || ''} · ${person.subscription_end ? new Date(person.subscription_end).toLocaleDateString() : 'активна'}` : 'Бесплатный'}</td><td><div className="admin-actions"><button onClick={async () => { try { setAdminDetail(await api.adminUser(person.id)) } catch (e) { setError(errorMessage(e)) } }}>Профиль</button><button onClick={() => void adminAction(() => api.adminCredits(person.id))}>+3 генерации</button><button onClick={() => void adminAction(() => api.adminSubscription(person.id, 'monthly'))}>Месяц</button><button onClick={() => void adminAction(() => api.adminSubscription(person.id, 'yearly'))}>Год</button><button className="danger-text" disabled={person.id === user.id && !person.is_blocked} onClick={() => void adminAction(() => api.adminBlock(person.id, !person.is_blocked))}>{person.is_blocked ? 'Разблокировать' : 'Блокировать'}</button></div></td></tr>)}</tbody></table></div>
        <div className="admin-section-title"><div><div className="eyebrow">ОПЛАТА</div><h2>Последние платежи</h2></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Дата</th><th>Тариф</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{adminPayments.slice(0, 20).map((payment) => <tr key={payment.id}><td>{new Date(payment.created_at).toLocaleString()}</td><td>{payment.tariff === 'yearly' ? 'Годовой' : 'Месячный'}</td><td>{payment.amount} {payment.currency}</td><td><span className={`status-pill ${payment.status}`}>{payment.status}</span></td></tr>)}</tbody></table></div>
      </section>}

      {view === 'tariff' && <section className="page-section tariff-page"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ПОДДЕРЖКА ВАШЕЙ РАБОТЫ</div><h1>{t.tariff}</h1><p>Выберите подходящий объём доступа к генератору.</p></div></div>{usage?.subscription_active && <div className="active-banner"><span>✓</span><div><b>Подписка активна</b><small>Доступ до {due}</small></div></div>}<div className="tariff-grid"><article className="tariff-card"><span className="tariff-label">СТАРТ</span><h2>Бесплатный</h2><div className="price">0 ₸ <small>/ всегда</small></div><p>Попробуйте создание КСП с помощью AI.</p><ul><li>3 генерации</li><li>Сохранение планов</li><li>Экспорт в DOCX</li></ul><button className="button secondary full-width" onClick={() => startWizard()}>Продолжить бесплатно</button></article><article className="tariff-card featured"><span className="recommended">ПОПУЛЯРНЫЙ</span><span className="tariff-label">МЕСЯЦ</span><h2>Месячный</h2><div className="price">750 ₸ <small>/ месяц</small></div><p>Продолжайте создавать планы весь месяц.</p><ul><li>Безлимитные генерации</li><li>Все функции КСП</li><li>Подписка на 30 дней</li></ul><button className="button primary full-width" onClick={() => void createPayment('monthly')} disabled={busy}>Подключить на месяц <span>→</span></button></article><article className="tariff-card"><span className="tariff-label">ГОД</span><h2>Годовой</h2><div className="price">5500 ₸ <small>/ год</small></div><p>Годовой доступ по более выгодной цене.</p><ul><li>Безлимитные генерации</li><li>Все функции КСП</li><li>Подписка на 365 дней</li></ul><button className="button secondary full-width" onClick={() => void createPayment('yearly')} disabled={busy}>Подключить на год <span>→</span></button></article></div><p className="test-note"><span>ⓘ</span> Платежи сейчас проходят в тестовом режиме — настоящие списания не выполняются.</p>{paymentId && <div className="payment-test"><b>Тестовый платёж создан</b><span>Выберите результат симуляции, чтобы проверить весь сценарий подписки.</span><div><button className="button primary" onClick={async () => { try { await api.simulatePayment(paymentId, 'success'); setPaymentId(''); await refresh(); setToast('Подписка активирована') } catch (e) { setError(errorMessage(e)) } }}>Симулировать успех</button><button className="button secondary" onClick={async () => { try { await api.simulatePayment(paymentId, 'failed'); setPaymentId(''); setToast('Платёж отмечен как неуспешный') } catch (e) { setError(errorMessage(e)) } }}>Симулировать ошибку</button><button className="text-button" onClick={async () => { try { await api.simulatePayment(paymentId, 'pending'); setToast('Платёж ожидает подтверждения') } catch (e) { setError(errorMessage(e)) } }}>Оставить ожидающим</button></div></div>}</section>}

      {view === 'help' && <section className="page-section"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ПОДСКАЗКИ</div><h1>{t.help}</h1><p>Начните с целей из учебной программы и задайте параметры урока.</p></div></div><div className="help-list">{[['01', 'Заполните сведения об уроке', 'Укажите педагога, предмет, класс, тему и раздел программы.'], ['02', 'Добавьте точные цели', 'Скопируйте цели обучения как в программе — генератор перенесёт их без замены формулировок.'], ['03', 'Уточните формат работы', 'Выберите длительность, язык, работу в группах и дополнительные пожелания.'], ['04', 'Проверьте и отредактируйте', 'Готовый план можно поправить и скачать в редактируемом формате DOCX.']].map(([n, title, text]) => <article key={n}><span>{n}</span><div><b>{title}</b><p>{text}</p></div></article>)}</div><button className="button primary" onClick={() => startWizard()}>{t.create}<span>→</span></button></section>}
    </main>
    {resumeDraft && view === 'home' && <div className="modal-backdrop"><div className="resume-modal"><button className="modal-close" onClick={() => { setResumeDraft(false); sessionStorage.removeItem('ksp_draft') }}>×</button><span className="card-icon blue">✎</span><h2>Продолжить создание КСП?</h2><p>Сохранённый черновик готов к продолжению.</p><div><button className="button secondary" onClick={() => { setResumeDraft(false); sessionStorage.removeItem('ksp_draft') }}>Начать заново</button><button className="button primary" onClick={() => startWizard(true)}>Продолжить <span>→</span></button></div></div></div>}
    {adminDetail && <div className="modal-backdrop" onClick={() => setAdminDetail(null)}><div className="resume-modal admin-detail-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setAdminDetail(null)}>×</button><span className="eyebrow">ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ</span><h2>{[adminDetail.user.first_name, adminDetail.user.last_name].filter(Boolean).join(' ') || 'Пользователь'}</h2><p>Telegram ID: {adminDetail.user.telegram_user_id}<br/>Бесплатных генераций: {adminDetail.user.free_generations}<br/>Подписка: {adminDetail.user.subscription_status} {adminDetail.user.subscription_type || ''}</p><div className="admin-detail-list"><b>Платежи</b>{adminDetail.payments.length ? adminDetail.payments.map((payment) => <span key={payment.id}>{payment.tariff} · {payment.amount} {payment.currency} · {payment.status}</span>) : <small>Платежей пока нет</small>}<b>Подписки</b>{adminDetail.subscriptions.length ? adminDetail.subscriptions.map((item) => <span key={item.id}>{item.type} · {item.status} · {item.end_date ? new Date(item.end_date).toLocaleDateString() : '—'}</span>) : <small>Подписок пока нет</small>}</div><button className="button secondary full-width" onClick={() => setAdminDetail(null)}>Закрыть</button></div></div>}
    {toast && <div className="toast">✓ {toast}</div>}
    <nav className="mobile-nav"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><span>⌂</span>Главная</button><button className={view === 'lessons' ? 'active' : ''} onClick={() => setView('lessons')}><span>▤</span>Мои КСП</button><button className="nav-create" onClick={() => startWizard()}><span>＋</span></button><button className={view === 'templates' ? 'active' : ''} onClick={() => setView('templates')}><span>▧</span>Шаблоны</button><button className={view === 'tariff' ? 'active' : ''} onClick={() => setView('tariff')}><span>◇</span>Тариф</button></nav>
  </div>
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) { return <div className={`field ${className}`}><label>{label}</label>{children}</div> }
function Review({ label, value }: { label: string; value: string }) { return <div className="review-item"><small>{label}</small><span>{value || '—'}</span></div> }
function ObjectiveEditor({ number, title, helper, values, onChange }: { number: string; title: string; helper: string; values: string[]; onChange: (v: string[]) => void }) { return <div className="objective-box"><div className="objective-heading"><span className="objective-number">{number}</span><div><b>{title}</b><small>{helper}</small></div></div>{values.map((value, index) => <div className="objective-input" key={index}><span>{index + 1}</span><textarea rows={2} value={value} onChange={(e) => onChange(values.map((x, i) => i === index ? e.target.value : x))} placeholder="Введите формулировку цели"/><button type="button" aria-label="Удалить цель" onClick={() => onChange(values.length > 1 ? values.filter((_, i) => i !== index) : [''])}>×</button></div>)}<button type="button" className="add-objective" onClick={() => onChange([...values, ''])}>＋ Добавить ещё цель</button></div> }

function KspEditor({ content, onChange }: { content: Lesson['content_json']; onChange: (content: Lesson['content_json']) => void }) {
  const field = (key: keyof Lesson['content_json'], value: any) => onChange({ ...content, [key]: value })
  const stages = (index: number, key: keyof Stage, value: string) => field('stages', content.stages.map((stage, i) => i === index ? { ...stage, [key]: value } : stage))
  return <div className="document-wrap"><div className="document-title">{content.title}</div><div className="document-subtitle">____________________________<br/><small>{content.language === 'kk' ? '(сабақ тақырыбы)' : '(тема урока)'}</small></div>
    <div className="ksp-meta">
      <div className="meta-section"><strong>{content.language === 'kk' ? 'Бөлім:' : 'Раздел:'}</strong><input aria-label={content.language === 'kk' ? 'Бөлім' : 'Раздел'} value={content.section} onChange={(e) => field('section', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Педагогтің аты-жөні:' : 'ФИО педагога:'}</div><div className="meta-value wide"><input value={content.teacher_name} onChange={(e) => field('teacher_name', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Күні:' : 'Дата:'}</div><div className="meta-value wide"><input value={content.date} onChange={(e) => field('date', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? `Сынып: ${content.class_name}` : `Класс: ${content.class_name}`}</div><div className="meta-value">{content.language === 'kk' ? 'Қатысқандар саны:' : 'Количество присутствующих:'} <input type="number" value={content.present_count} onChange={(e) => field('present_count', Number(e.target.value))} /></div><div className="meta-value">{content.language === 'kk' ? 'Қатыспағандар саны:' : 'Количество отсутствующих:'} <input type="number" value={content.absent_count} onChange={(e) => field('absent_count', Number(e.target.value))} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Сабақ тақырыбы:' : 'Тема урока:'}</div><div className="meta-value wide"><input value={content.lesson_topic} onChange={(e) => field('lesson_topic', e.target.value)} /></div>
      <div className="meta-label tall">{content.language === 'kk' ? 'Оқу бағдарламасына сәйкес оқу мақсаттары' : 'Цели обучения в соответствии с учебной программой'}</div><div className="meta-value wide tall"><ListEditor values={content.learning_objectives} onChange={(v) => field('learning_objectives', v)}/></div>
      <div className="meta-label">{content.language === 'kk' ? 'Сабақ мақсаттары' : 'Цели урока'}</div><div className="meta-value wide"><ListEditor values={content.lesson_objectives} onChange={(v) => field('lesson_objectives', v)}/></div>
      <div className="meta-journey">{content.language === 'kk' ? 'Сабақ барысы' : 'Ход урока'}</div>
    </div>
    <div className="table-scroll"><table className="ksp-table"><thead><tr><th>{content.language === 'kk' ? 'Сабақ кезеңі/уақыты' : 'Этап урока/время'}</th><th>{content.language === 'kk' ? 'Педагогтің әрекеті' : 'Действия педагога'}</th><th>{content.language === 'kk' ? 'Оқушының әрекеті' : 'Действия ученика'}</th><th>{content.language === 'kk' ? 'Ресурстар' : 'Ресурсы'}</th><th>{content.language === 'kk' ? 'Бағалау' : 'Оценивание'}</th></tr></thead><tbody>{content.stages.map((stage, index) => <tr key={index}><td><input aria-label={content.language === 'kk' ? 'Сабақ кезеңі' : 'Этап урока'} value={stage.stage_name} onChange={(e) => stages(index, 'stage_name', e.target.value)}/><input className="time-input" aria-label={content.language === 'kk' ? 'Уақыт' : 'Время'} value={stage.time} onChange={(e) => stages(index, 'time', e.target.value)}/></td><td><textarea value={stage.teacher_actions} onChange={(e) => stages(index, 'teacher_actions', e.target.value)}/></td><td><textarea value={stage.student_actions} onChange={(e) => stages(index, 'student_actions', e.target.value)}/></td><td><textarea value={stage.resources} onChange={(e) => stages(index, 'resources', e.target.value)}/></td><td><textarea value={stage.assessment} onChange={(e) => stages(index, 'assessment', e.target.value)}/></td></tr>)}</tbody></table></div>
    <div className="document-bottom"><label>{content.language === 'kk' ? 'Үй тапсырмасы' : 'Домашнее задание'}<textarea value={content.homework} onChange={(e) => field('homework', e.target.value)} placeholder={content.language === 'kk' ? 'Тапсырма жоқ' : 'Не задано'} rows={2}/></label><label>{content.language === 'kk' ? 'Рефлексия' : 'Рефлексия'}<textarea value={content.reflection} onChange={(e) => field('reflection', e.target.value)} rows={2}/></label></div>
  </div>
}
function ListEditor({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) { return <div className="list-editor">{values.map((value, index) => <div key={index}><textarea rows={2} value={value} onChange={(e) => onChange(values.map((item, i) => i === index ? e.target.value : item))}/><button aria-label="Удалить" onClick={() => onChange(values.length > 1 ? values.filter((_, i) => i !== index) : [''])}>×</button></div>)}<button className="mini-add" onClick={() => onChange([...values, ''])}>＋ добавить</button></div>}

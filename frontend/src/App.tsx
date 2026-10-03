import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, AdminStats, getToken, Lesson, Stage, SubscriptionInfo, TeacherProfile, Template, Usage, User, setToken } from './api'
import WebApp from '@twa-dev/sdk'

type View = 'home' | 'wizard' | 'lessons' | 'templates' | 'tariff' | 'help' | 'preview' | 'admin'
type Language = 'ru' | 'kk'
type AdminPayment = { id: string; amount: number; currency: string; status: string; tariff: string; created_at: string }
type AdminDetail = { user: User; payments: AdminPayment[]; subscriptions: { id: string; type: string; status: string; start_date: string | null; end_date: string | null }[] }
type FormData = {
  teacher_name: string; lesson_date: string; subject: string; section: string; grade: string; present_count: number; absent_count: number; topic: string
  learning_objectives: string[]; lesson_objectives: string[]; lesson_duration: number; lesson_type: string; class_level: string; students_count: number
  language: Language; difficulty: string; work_formats: string[]; pair_work: boolean; group_work: boolean; individual_work: boolean; differentiation: boolean
  homework_required: boolean; reflection_required: boolean; interactive_tasks: boolean; substitute_mode: boolean; additional_requirements: string; template_id: string | null
}

function localToday() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const initialForm: FormData = { teacher_name: '', lesson_date: localToday(), subject: '', section: '', grade: '', present_count: 0, absent_count: 0, topic: '', learning_objectives: [''], lesson_objectives: [''], lesson_duration: 45, lesson_type: 'Комбинированный урок', class_level: 'Средний', students_count: 0, language: 'ru', difficulty: 'Средний', work_formats: [], pair_work: false, group_work: false, individual_work: true, differentiation: false, homework_required: true, reflection_required: true, interactive_tasks: false, substitute_mode: false, additional_requirements: '', template_id: null }
const copy = {
  ru: { create: 'Создать КСП', mine: 'Мои КСП', templates: 'Мои шаблоны', tariff: 'Мой тариф', help: 'Помощь', remaining: 'Бесплатных генераций', activeUntil: 'Подписка активна до', subtitle: 'Готовый поурочный план по вашему шаблону — за несколько минут.', start: 'Начать создание', welcome: 'Добро пожаловать', step: 'Шаг', back: 'Назад', next: 'Далее', generate: 'Сформировать КСП', generating: 'Формируем ваш план…', standard: 'Стандартный шаблон', upload: 'Загрузить свой шаблон', save: 'Сохранить изменения', download: 'Скачать DOCX', regenerate: 'Создать другой вариант', empty: 'Пока нет сохранённых КСП', close: 'Закрыть', cancel: 'Отмена', preview: 'Предпросмотр', subscribe: 'Выбрать тариф', language: 'Язык КСП' },
  kk: { create: 'ҚМЖ құру', mine: 'Менің ҚМЖ-ларым', templates: 'Менің үлгілерім', tariff: 'Менің тарифім', help: 'Көмек', remaining: 'Тегін генерация қалды', activeUntil: 'Жазылым мерзімі', subtitle: 'Үлгіңізге сай дайын сабақ жоспары — бірнеше минутта.', start: 'Құруды бастау', welcome: 'Қош келдіңіз', step: 'Қадам', back: 'Артқа', next: 'Келесі', generate: 'ҚМЖ жасау', generating: 'Жоспар жасалуда…', standard: 'Стандартты үлгі', upload: 'Үлгі жүктеу', save: 'Өзгерістерді сақтау', download: 'DOCX жүктеу', regenerate: 'Басқа нұсқа жасау', empty: 'Сақталған ҚМЖ жоқ', close: 'Жабу', cancel: 'Бас тарту', preview: 'Алдын ала көру', language: 'ҚМЖ тілі', subscribe: 'Тариф таңдау' },
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Не удалось выполнить запрос' }
function httpStatus(error: unknown) { return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined }
function defaultContent(lesson: Lesson): Lesson['content_json'] { return structuredClone(lesson.content_json) }

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [profileNameInput, setProfileNameInput] = useState('')
  const [profileClassesInput, setProfileClassesInput] = useState<string[]>([''])
  const [profileSubjectsInput, setProfileSubjectsInput] = useState<string[]>([''])
  const languageInitialized = useRef(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null)
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
  const [substituteMode, setSubstituteMode] = useState(false)
  const [archiveQuery, setArchiveQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [paymentId, setPaymentId] = useState('')
  const [resumeDraft, setResumeDraft] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [searchObjective, setSearchObjective] = useState('')
  const t = copy[language]
  const objectiveSuggestions = useMemo(() => Array.from(new Set(lessons.flatMap((lesson) => lesson.learning_objectives))).slice(0, 40), [lessons])
  const visibleLessons = useMemo(() => {
    const query = archiveQuery.trim().toLocaleLowerCase()
    if (!query) return lessons
    return lessons.filter((lesson) => [lesson.topic, lesson.grade, lesson.subject, lesson.section, lesson.lesson_date, lesson.created_at, ...lesson.learning_objectives]
      .some((value) => value.toLocaleLowerCase().includes(query)))
  }, [archiveQuery, lessons])

  const refresh = useCallback(async () => {
    const [currentUser, currentUsage, userLessons, userTemplates, subscription, currentProfile] = await Promise.all([api.me(), api.usage(), api.lessons(), api.templates(), api.subscription(), api.teacherProfile()])
    setUser(currentUser); setUsage(currentUsage); setLessons(userLessons); setTemplates(userTemplates); setSubscriptionInfo(subscription)
    setTeacherProfile(currentProfile); setProfileLoaded(true)
    if (currentProfile) {
      setProfileNameInput(currentProfile.full_name)
      setProfileClassesInput(currentProfile.classes)
      setProfileSubjectsInput(currentProfile.subjects)
    } else {
      setProfileNameInput([currentUser.first_name, currentUser.last_name].filter(Boolean).join(' '))
    }
    if (!languageInitialized.current) { setLanguage(currentUser.language.toLowerCase().startsWith('kk') ? 'kk' : 'ru'); languageInitialized.current = true }
  }, [])

  useEffect(() => {
    WebApp.ready(); WebApp.expand()
    const applyTheme = () => {
      const theme = WebApp.themeParams
      const root = document.documentElement
      const scheme = WebApp.colorScheme === 'dark' ? 'dark' : 'light'
      const fallback = scheme === 'dark'
        ? { bg: '#17212b', text: '#e7edf5', hint: '#a6b3c2', link: '#6ab3f2', button: '#5288c1', buttonText: '#ffffff', secondary: '#212d3b' }
        : { bg: '#f4f8fb', text: '#23364c', hint: '#8190a1', link: '#1682e8', button: '#147fe3', buttonText: '#ffffff', secondary: '#ffffff' }
      const colors = {
        bg: theme.bg_color || fallback.bg,
        text: theme.text_color || fallback.text,
        hint: theme.hint_color || fallback.hint,
        link: theme.link_color || fallback.link,
        button: theme.button_color || fallback.button,
        buttonText: theme.button_text_color || fallback.buttonText,
        secondary: theme.secondary_bg_color || fallback.secondary,
      }
      root.dataset.telegramTheme = scheme
      root.style.colorScheme = scheme
      root.style.setProperty('--tg-theme-bg-color', colors.bg)
      root.style.setProperty('--tg-theme-text-color', colors.text)
      root.style.setProperty('--tg-theme-hint-color', colors.hint)
      root.style.setProperty('--tg-theme-link-color', colors.link)
      root.style.setProperty('--tg-theme-button-color', colors.button)
      root.style.setProperty('--tg-theme-button-text-color', colors.buttonText)
      root.style.setProperty('--tg-theme-secondary-bg-color', colors.secondary)
      root.style.setProperty('--tg-button-color', colors.button)
      root.style.setProperty('--tg-button-text-color', colors.buttonText)
      root.style.setProperty('--tg-bg-color', colors.bg)
      root.style.setProperty('--tg-text-color', colors.text)
      root.style.setProperty('--tg-hint-color', colors.hint)
      root.style.setProperty('--tg-secondary-bg-color', colors.secondary)
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.header_bg_color || colors.bg)
      WebApp.setBackgroundColor(colors.bg)
      WebApp.setHeaderColor(theme.header_bg_color || colors.bg)
    }
    const updateViewport = () => {
      document.documentElement.style.setProperty('--tg-viewport-height', `${WebApp.viewportHeight}px`)
      document.documentElement.style.setProperty('--tg-viewport-stable-height', `${WebApp.viewportStableHeight}px`)
    }
    applyTheme()
    updateViewport()
    WebApp.onEvent('themeChanged', applyTheme)
    WebApp.onEvent('viewportChanged', updateViewport)
    const initData = WebApp.initData
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
    return () => { WebApp.offEvent('themeChanged', applyTheme); WebApp.offEvent('viewportChanged', updateViewport) }
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
  useEffect(() => {
    const handleBack = () => setView((current) => current === 'preview' ? 'lessons' : 'home')
    if (view === 'home') { WebApp.BackButton.hide(); return }
    WebApp.BackButton.onClick(handleBack)
    WebApp.BackButton.show()
    return () => { WebApp.BackButton.offClick(handleBack); WebApp.BackButton.hide() }
  }, [view])
  useEffect(() => {
    const submit = () => document.querySelector<HTMLFormElement>('#ksp-form')?.requestSubmit()
    if (view !== 'wizard') { WebApp.MainButton.hide(); return }
    WebApp.MainButton.setText(busy ? (language === 'kk' ? 'Жоспар жасалуда…' : 'Формируем КСП…') : t.generate)
    WebApp.MainButton.setParams({ is_visible: true, is_active: !busy })
    if (busy) WebApp.MainButton.showProgress()
    else WebApp.MainButton.hideProgress()
    WebApp.MainButton.onClick(submit)
    WebApp.MainButton.show()
    return () => { WebApp.MainButton.offClick(submit); WebApp.MainButton.hide(); WebApp.MainButton.hideProgress() }
  }, [busy, language, t.generate, view])
  useEffect(() => {
    if (isDirty && (view === 'wizard' || view === 'preview')) WebApp.enableClosingConfirmation()
    else WebApp.disableClosingConfirmation()
  }, [isDirty, view])

  const startWizard = (keepDraft = false, source?: Lesson, forSubstitute = false) => {
    let draftIsSubstitute = false
    if (keepDraft) {
      try { const saved: unknown = JSON.parse(sessionStorage.getItem('ksp_draft') || '{}'); const savedForm = typeof saved === 'object' && saved !== null && 'form' in saved ? saved.form : undefined; draftIsSubstitute = typeof saved === 'object' && saved !== null && 'substituteMode' in saved && saved.substituteMode === true; setForm({ ...initialForm, ...(typeof savedForm === 'object' && savedForm !== null ? savedForm : {}) } as FormData) } catch { setForm(initialForm) }
    } else {
      const recent = source || (forSubstitute ? undefined : lessons[0])
      const profileName = teacherProfile?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ')
      setForm({
        ...initialForm,
        teacher_name: recent?.teacher_name || profileName || 'Учитель на замене',
        lesson_date: localToday(), subject: recent?.subject || teacherProfile?.subjects[0] || '', grade: recent?.grade || teacherProfile?.classes[0] || '', section: recent?.section || '',
        topic: source?.topic || '', language: recent?.language === 'kk' ? 'kk' : (user?.language === 'kk' ? 'kk' : language),
        learning_objectives: source ? [...source.learning_objectives] : [''],
        lesson_objectives: source ? [...source.lesson_objectives] : [''],
        lesson_duration: source?.content_json.lesson_duration || 45,
      })
      sessionStorage.removeItem('ksp_draft')
    }
    setSubstituteMode(keepDraft ? draftIsSubstitute : forSubstitute)
    setSearchObjective('')
    setIsDirty(false)
    setError(''); setView('wizard'); setResumeDraft(false)
  }
  const updateForm = <K extends keyof FormData>(key: K, value: FormData[K]) => { setIsDirty(true); setForm((previous) => ({ ...previous, [key]: value })) }
  const saveDraft = () => { sessionStorage.setItem('ksp_draft', JSON.stringify({ form, substituteMode })); setToast('Черновик сохранён') }
  const generate = async (event?: FormEvent) => {
    event?.preventDefault()
    const learningObjectives = form.learning_objectives.map((value) => value.trim()).filter(Boolean)
    const lessonObjectives = form.lesson_objectives.map((value) => value.trim()).filter(Boolean)
    const topic = form.topic.trim() || learningObjectives[0] || ''
    if (!form.subject.trim() || !form.grade.trim() || !topic) {
      setError(language === 'kk' ? 'Сыныпты, пәнді және тақырыпты немесе оқу мақсатын толтырыңыз.' : 'Укажите класс, предмет и тему урока или цель обучения.')
      return
    }
    setBusy(true); setError('')
    try {
      const generated = await api.generate({
        ...form, substitute_mode: substituteMode, teacher_name: form.teacher_name.trim() || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Учитель на замене',
        lesson_date: form.lesson_date || localToday(), section: form.section.trim() || (language === 'kk' ? 'Көрсетілмеген' : 'Не указан'),
        topic: topic.slice(0, 300), learning_objectives: learningObjectives, lesson_objectives: lessonObjectives,
      })
      setActive(generated); setContent(defaultContent(generated)); setView('preview'); setIsDirty(false); sessionStorage.removeItem('ksp_draft'); WebApp.HapticFeedback.notificationOccurred('success'); await refresh()
    } catch (e) { setError(errorMessage(e)); if (httpStatus(e) === 402) setView('tariff'); WebApp.HapticFeedback.notificationOccurred('error') }
    finally { setBusy(false) }
  }
  const openLesson = async (lesson: Lesson) => { setActive(lesson); setContent(defaultContent(lesson)); setView('preview'); setIsDirty(false); setError('') }
  const saveLesson = async () => {
    if (!active || !content) return
    setBusy(true); setError('')
    try { const updated = await api.updateLesson(active.id, content); setActive(updated); setContent(updated.content_json); setIsDirty(false); await refresh(); setToast('Изменения сохранены') }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const persistPendingChanges = async (lesson: Lesson) => {
    if (!isDirty || !content || active?.id !== lesson.id) return lesson
    const updated = await api.updateLesson(lesson.id, content)
    setActive(updated); setContent(updated.content_json); setIsDirty(false); await refresh()
    return updated
  }
  const download = async (lesson: Lesson) => {
    setBusy(true)
    try { const saved = await persistPendingChanges(lesson); const blob = await api.exportDocx(saved.id); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `ksp-${saved.topic.slice(0, 45).replace(/[^\p{L}\p{N}-]+/gu, '-')}.docx`; a.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const downloadPdf = async (lesson: Lesson) => {
    setBusy(true)
    try { const saved = await persistPendingChanges(lesson); const blob = await api.exportPdf(saved.id); const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `ksp-${saved.topic.slice(0, 45).replace(/[^\p{L}\p{N}-]+/gu, '-')}.pdf`; a.click(); window.setTimeout(() => URL.revokeObjectURL(href), 1000) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const regenerate = async () => {
    if (!active) return
    setBusy(true); setError('')
    try { const saved = await persistPendingChanges(active); const updated = await api.regenerate(saved.id); setActive(updated); setContent(updated.content_json); await refresh(); setToast('Новый вариант готов') }
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
  const saveTeacherProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const classes = profileClassesInput.map((value) => value.trim()).filter(Boolean)
    const subjects = profileSubjectsInput.map((value) => value.trim()).filter(Boolean)
    setBusy(true); setError('')
    try {
      const saved = await api.saveTeacherProfile({ full_name: profileNameInput.trim(), classes, subjects })
      setTeacherProfile(saved); setProfileLoaded(true); setProfileNameInput(saved.full_name)
      setProfileClassesInput(saved.classes); setProfileSubjectsInput(saved.subjects)
      setToast('Профиль сохранён'); WebApp.HapticFeedback.notificationOccurred('success')
    } catch (e) { setError(errorMessage(e)); WebApp.HapticFeedback.notificationOccurred('error') }
    finally { setBusy(false) }
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

  if (!profileLoaded) return <main className="auth-shell"><div className="brand-mark">К</div><h1>КСП Генератор</h1><p>Загружаем профиль учителя…</p></main>

  if (!teacherProfile) return <main className="auth-shell onboarding-shell"><form className="onboarding-card" onSubmit={(event) => void saveTeacherProfile(event)}>
    <div className="brand-mark">К</div><div className="eyebrow">ПЕРВЫЙ ШАГ</div><h1>{language === 'kk' ? 'Мұғалім профилі' : 'Давайте познакомимся'}</h1>
    <p>{language === 'kk' ? 'Ақпаратты бір рет енгізіңіз — ҚМЖ жасағанда автоматты түрде толтырылады.' : 'Заполните профиль один раз — данные будут подставляться в ваши планы уроков.'}</p>
    <label className="onboarding-field"><span>{language === 'kk' ? 'Тегі, аты, әкесінің аты' : 'Фамилия, имя и отчество'}</span><input required minLength={3} maxLength={200} autoComplete="name" value={profileNameInput} onChange={(event) => setProfileNameInput(event.target.value)} placeholder="Иванов Иван Иванович" /></label>
    <div className="onboarding-field"><span>{language === 'kk' ? 'Сіз сабақ беретін сыныптар' : 'Какие классы ведёте?'}</span><small>{language === 'kk' ? 'Мысалы: 5А, 7Б' : 'Например: 5А, 7Б'}</small><div className="onboarding-list">{profileClassesInput.map((value, index) => <div className="onboarding-list-row" key={`class-${index}`}><input required={index === 0} maxLength={80} value={value} onChange={(event) => setProfileClassesInput((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={language === 'kk' ? 'Сынып' : 'Класс'} />{profileClassesInput.length > 1 && <button type="button" className="onboarding-remove" onClick={() => setProfileClassesInput((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить класс">×</button>}</div>)}</div><button type="button" className="onboarding-add" disabled={profileClassesInput.length >= 20} onClick={() => setProfileClassesInput((items) => [...items, ''])}>＋ {language === 'kk' ? 'Сынып қосу' : 'Добавить класс'}</button></div>
    <div className="onboarding-field"><span>{language === 'kk' ? 'Оқытатын пәндеріңіз' : 'Какие предметы преподаёте?'}</span><small>{language === 'kk' ? 'Мысалы: Математика, Физика' : 'Например: Математика, Физика'}</small><div className="onboarding-list">{profileSubjectsInput.map((value, index) => <div className="onboarding-list-row" key={`subject-${index}`}><input required={index === 0} maxLength={80} value={value} onChange={(event) => setProfileSubjectsInput((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={language === 'kk' ? 'Пән' : 'Предмет'} />{profileSubjectsInput.length > 1 && <button type="button" className="onboarding-remove" onClick={() => setProfileSubjectsInput((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить предмет">×</button>}</div>)}</div><button type="button" className="onboarding-add" disabled={profileSubjectsInput.length >= 30} onClick={() => setProfileSubjectsInput((items) => [...items, ''])}>＋ {language === 'kk' ? 'Пән қосу' : 'Добавить предмет'}</button></div>
    {error && <div className="alert" role="alert">{error}</div>}<button className="button primary large onboarding-submit" type="submit" disabled={busy}>{busy ? (language === 'kk' ? 'Сақталуда…' : 'Сохраняем…') : (language === 'kk' ? 'Жалғастыру' : 'Сохранить и продолжить')}</button>
  </form></main>

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setView('home')} aria-label="На главную"><span className="brand-mark">К</span><span>КСП Генератор</span></button><div className="top-actions"><div className="lang-switch"><button className={language === 'ru' ? 'selected' : ''} onClick={() => setLanguage('ru')}>RU</button><button className={language === 'kk' ? 'selected' : ''} onClick={() => setLanguage('kk')}>KZ</button></div><span className="avatar">{(user.first_name || 'У').slice(0, 1).toUpperCase()}</span></div></header>
    <main className="content">
      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть">×</button></div>}
      {view === 'home' && <>
        <section className="hero"><div className="hero-copy"><div className="eyebrow">ПЛАН УРОКА · КАЗАХСТАН</div><h1>{t.welcome},<br />{user.first_name || 'учитель'}!</h1><p>{t.subtitle}</p><button className="button primary large" onClick={() => startWizard()}><span className="plus">＋</span>{t.start}<span>→</span></button></div><div className="hero-art" aria-hidden="true"><div className="paper"><div className="paper-line short"/><div className="paper-line"/><div className="paper-row"><i/><i/><i/></div><div className="paper-line"/><div className="paper-row"><i/><i/><i/></div><div className="paper-line short"/><div className="paper-check">✓</div></div><div className="sparkle s1">✳</div><div className="sparkle s2">✦</div></div></section>
        <section className="usage-card"><div><span className="usage-icon">✦</span><div><strong>{usage?.subscription_active ? `${t.activeUntil} ${due}` : t.remaining}</strong><small>{usage?.subscription_active ? (usage.subscription_type === 'yearly' ? 'Годовой тариф' : 'Месячный тариф') : `${usage?.free_generations ?? 0} из ${usage?.free_generations_total ?? 3} доступно`}</small></div></div><div className="usage-side"><div className="meter"><span style={{ width: usage?.subscription_active ? '100%' : `${Math.max(0, ((usage?.free_generations ?? 0) / (usage?.free_generations_total || 3)) * 100)}%` }}/></div><button className="text-button" onClick={() => setView('tariff')}>{t.subscribe} <span>→</span></button></div></section>
        <section className="section-heading"><div><div className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</div><h2>Всё для урока</h2></div><span className="muted">{usage?.lessons_created ?? 0} документов</span></section>
        <section className="home-grid">
          <button className="nav-card create-card" onClick={() => startWizard()}><span className="card-icon blue">✦</span><span className="card-copy"><b>Новый КСП</b><small>Тема, класс, предмет и цель в одном экране</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card substitute-card" onClick={() => startWizard(false, undefined, true)}><span className="card-icon peach">↗</span><span className="card-copy"><b>Учитель на замене</b><small>Быстрый план только по классу, предмету и теме</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('lessons')}><span className="card-icon lavender">▤</span><span className="card-copy"><b>{t.mine}</b><small>{usage?.lessons_created ?? 0} сохранённых планов</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('templates')}><span className="card-icon mint">▧</span><span className="card-copy"><b>{t.templates}</b><small>Ваши форматы документов</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('tariff')}><span className="card-icon peach">◇</span><span className="card-copy"><b>{t.tariff}</b><small>Тарифы и история оплаты</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('help')}><span className="card-icon gray">?</span><span className="card-copy"><b>{t.help}</b><small>Как подготовить КСП</small></span><span className="card-arrow">↗</span></button>
          {user.is_admin && <button className="nav-card" onClick={() => { setView('admin'); void refreshAdmin() }}><span className="card-icon gray">⚙</span><span className="card-copy"><b>Администрирование</b><small>Статистика и пользователи</small></span><span className="card-arrow">↗</span></button>}
        </section>
        <footer className="footer-note"><span>✳</span> Создано для учителей Казахстана <span className="footer-dot"/> Ваши планы всегда под рукой</footer>
      </>}

      {view === 'wizard' && <section className="panel wizard-panel">
        <div className="panel-top"><button className="back-link" type="button" onClick={() => setView('home')}>← Главная</button><button className="text-button" type="button" onClick={saveDraft}>Сохранить черновик</button></div>
        <div className="wizard-title"><div className="eyebrow">{substituteMode ? 'БЫСТРЫЙ РЕЖИМ' : 'СОЗДАНИЕ КСП'}</div><h1>{substituteMode ? 'КСП для учителя на замене' : 'Новый КСП'}</h1><p>{substituteMode ? 'Укажите класс, предмет и тему или цель. Остальные сведения заполним автоматически.' : 'Класс и предмет взяты из вашего последнего КСП. Проверьте тему и цель обучения.'}</p></div>
        <div className="mode-switch" role="group" aria-label="Режим создания"><button type="button" className={!substituteMode ? 'selected' : ''} onClick={() => setSubstituteMode(false)}>Обычный учитель</button><button type="button" className={substituteMode ? 'selected' : ''} onClick={() => setSubstituteMode(true)}>Учитель на замене</button></div>
        <form id="ksp-form" onSubmit={generate}>
          <div className="form-grid quick-form-grid">
            <Field label={language === 'kk' ? 'Пән' : 'Предмет'}><input value={form.subject} onChange={(e) => updateForm('subject', e.target.value)} placeholder={language === 'kk' ? 'Математика' : 'Математика'} required /></Field>
            <Field label={language === 'kk' ? 'Сынып' : 'Класс'}><input value={form.grade} onChange={(e) => updateForm('grade', e.target.value)} placeholder={language === 'kk' ? '7А' : '7А'} required /></Field>
            <Field label={language === 'kk' ? 'Сабақ тақырыбы' : 'Тема урока'} className="full"><input value={form.topic} onChange={(e) => updateForm('topic', e.target.value)} placeholder={language === 'kk' ? 'Тақырыпты немесе оқу мақсатын енгізіңіз' : 'Введите тему урока; можно оставить пустым и указать цель'} /></Field>
            <div className="field full objective-search">
              <label htmlFor="objective-search">{language === 'kk' ? 'Оқу мақсаты — коды немесе мәтіні' : 'Цель обучения — код или текст'}</label>
              <div className="objective-search-row"><input id="objective-search" list="objective-suggestions" value={searchObjective} onChange={(e) => setSearchObjective(e.target.value)} placeholder={language === 'kk' ? 'Мысалы, 7.2.1.1 немесе мақсат мәтіні' : 'Например, 7.2.1.1 или формулировка цели'} /><button type="button" className="button secondary" onClick={() => { const value = searchObjective.trim(); if (value && !form.learning_objectives.includes(value)) updateForm('learning_objectives', [...form.learning_objectives.filter(Boolean), value]); setSearchObjective('') }}>Добавить</button></div>
              <datalist id="objective-suggestions">{objectiveSuggestions.map((objective) => <option key={objective} value={objective}/>)}</datalist>
              <small className="hint">Подсказки взяты из ваших сохранённых КСП. Официальный справочник целей в проекте не найден; передайте точный текст и код из программы, если они важны.</small>
              {!!form.learning_objectives.filter(Boolean).length && <div className="selected-objectives">{form.learning_objectives.filter(Boolean).map((objective, index) => <button key={index} type="button" onClick={() => updateForm('learning_objectives', form.learning_objectives.filter((_, i) => i !== index))}>{objective} <span aria-hidden="true">×</span></button>)}</div>}
            </div>
            <Field label={language === 'kk' ? 'Сабақ ұзақтығы' : 'Длительность урока'}><select value={form.lesson_duration} onChange={(e) => updateForm('lesson_duration', Number(e.target.value))}>{[40, 45, 50, 60, 80].map((minutes) => <option key={minutes} value={minutes}>{minutes} минут</option>)}</select></Field>
            {!substituteMode && <Field label={t.language}><select value={language} onChange={(e) => { const selected = e.target.value as Language; setLanguage(selected); updateForm('language', selected) }}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></Field>}
          </div>
          {!substituteMode && <details className="advanced-fields"><summary>Дополнительные параметры (необязательно)</summary>
            <div className="form-grid">
              <Field label={language === 'kk' ? 'Педагогтің аты-жөні' : 'ФИО педагога'}><input value={form.teacher_name} onChange={(e) => updateForm('teacher_name', e.target.value)} /></Field>
              <Field label={language === 'kk' ? 'Сабақ күні' : 'Дата урока'}><input type="date" value={form.lesson_date} onChange={(e) => updateForm('lesson_date', e.target.value)} /></Field>
              <Field label={language === 'kk' ? 'Бөлім' : 'Раздел'}><input value={form.section} onChange={(e) => updateForm('section', e.target.value)} /></Field>
              <Field label={language === 'kk' ? 'Сабақ түрі' : 'Тип урока'}><select value={form.lesson_type} onChange={(e) => updateForm('lesson_type', e.target.value)}>{(language === 'kk' ? ['Аралас сабақ', 'Жаңа тақырыпты меңгеру', 'Бекіту', 'Қайталау', 'Білімді бақылау', 'Практикалық жұмыс'] : ['Комбинированный урок', 'Изучение нового материала', 'Закрепление', 'Повторение', 'Контроль знаний', 'Практическая работа']).map((value) => <option key={value}>{value}</option>)}</select></Field>
              <Field label={language === 'kk' ? 'ҚМЖ үлгісі' : 'Шаблон КСП'} className="full"><select value={form.template_id || ''} onChange={(e) => updateForm('template_id', e.target.value || null)}><option value="">{t.standard}</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
              <Field label={language === 'kk' ? 'Мақсаттар сабақ' : 'Цели урока'} className="full"><ObjectiveEditor number="02" title="Измеримые результаты урока" helper="Если оставить пустым, AI сформулирует их на основе темы и цели обучения." values={form.lesson_objectives} onChange={(values) => updateForm('lesson_objectives', values)} /></Field>
              <div className="field full"><label>{language === 'kk' ? 'Сабақ параметрлері' : 'Параметры урока'}</label><div className="check-grid compact-checks">{([['differentiation', 'Дифференциация'], ['homework_required', 'Домашнее задание'], ['reflection_required', 'Рефлексия'], ['pair_work', 'Работа в парах'], ['group_work', 'Групповая работа']] as const).map(([key, label]) => <label className="check-option" key={key}><input type="checkbox" checked={form[key]} onChange={(e) => updateForm(key, e.target.checked)} /><span className="check-custom">✓</span><span>{label}</span></label>)}</div></div>
              <Field label={language === 'kk' ? 'Қосымша талаптар' : 'Дополнительные пожелания'} className="full"><textarea maxLength={3000} rows={3} value={form.additional_requirements} onChange={(e) => updateForm('additional_requirements', e.target.value)} placeholder="Особые условия или акценты для этого урока" /></Field>
              <div className="field-pair"><Field label={language === 'kk' ? 'Қатысқандар' : 'Присутствуют'}><input type="number" min="0" max="1000" value={form.present_count} onChange={(e) => updateForm('present_count', Number(e.target.value))} /></Field><Field label={language === 'kk' ? 'Қатыспағандар' : 'Отсутствуют'}><input type="number" min="0" max="1000" value={form.absent_count} onChange={(e) => updateForm('absent_count', Number(e.target.value))} /></Field></div>
            </div>
          </details>}
          <div className="privacy-note"><span>✦</span><span>Цели обучения и параметры урока отправляются выбранному AI-провайдеру. Не добавляйте персональные данные учеников.</span></div>
          {error && <div className="inline-error">{error}</div>}
          <div className="wizard-footer"><button type="button" className="button secondary" onClick={() => setView('home')}>Отмена</button><button type="submit" className="button primary" disabled={busy}>{busy ? <><span className="spinner"/>{t.generating}</> : <>{t.generate}<span>✦</span></>}</button></div>
        </form>
      </section>}

      {view === 'preview' && active && content && <section className="panel preview-panel"><div className="panel-top"><button className="back-link" onClick={() => setView('lessons')}>← {t.mine}</button><span className="saved-pill">{isDirty ? 'Есть несохранённые изменения' : 'Сохранено'}</span></div><div className="preview-head"><div><div className="eyebrow">{t.preview}</div><h1>{content.lesson_topic}</h1><p>{content.subject} · {content.class_name} класс · {content.date}</p></div><div className="preview-actions"><button className="button secondary" onClick={regenerate} disabled={busy}>{busy ? <span className="spinner"/> : '↻'} {t.regenerate}{usage?.subscription_active ? '' : ' · −1'}</button><button className="button primary" onClick={() => void download(active)}>DOCX <span>↓</span></button><button className="button secondary" onClick={() => void downloadPdf(active)}>PDF <span>↓</span></button></div></div><KspEditor content={content} onChange={(updated) => { setContent(updated); setIsDirty(true) }} /><div className="edit-footer"><span>Изменения сохраняются в ваших КСП.</span><button className="button primary" onClick={() => void saveLesson()} disabled={busy}>{busy ? 'Сохраняем…' : t.save}</button></div>{error && <div className="inline-error">{error}</div>}</section>}

      {view === 'lessons' && <section className="page-section">
        <div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ВАША БИБЛИОТЕКА</div><h1>{t.mine}</h1><p>Ваши планы сохраняются в облачном архиве.</p></div><button className="button primary" onClick={() => startWizard()}>{t.create}<span>＋</span></button></div>
        <label className="archive-search"><span>⌕</span><input type="search" value={archiveQuery} onChange={(e) => setArchiveQuery(e.target.value)} placeholder="Поиск по теме, классу, предмету, цели или дате" /></label>
        {visibleLessons.length ? <div className="lesson-list">{visibleLessons.map((lesson) => <article className="lesson-card" key={lesson.id}>
          <div className="lesson-symbol">▤</div><div className="lesson-details"><span className="eyebrow">{lesson.subject} · {lesson.grade} КЛАСС</span><h3>{lesson.topic}</h3><p>{lesson.lesson_date} <i/> Сохранён {new Date(lesson.created_at).toLocaleDateString()}</p></div>
          <div className="lesson-buttons">
            <button onClick={() => void openLesson(lesson)}>Открыть / изменить</button><button onClick={() => chooseDownload(lesson)}>Скачать Word</button>
            <button onClick={() => startWizard(false, lesson)}>Новый на основе</button>
            <button onClick={async () => { try { const duplicate = await api.copyLesson(lesson.id); await refresh(); await openLesson(duplicate); setToast('Копия создана и готова к редактированию') } catch (e) { setError(errorMessage(e)) } }}>Создать копию</button>
            <button className="danger-text" onClick={async () => { if (window.confirm('Удалить этот КСП?')) { try { await api.deleteLesson(lesson.id); await refresh() } catch (e) { setError(errorMessage(e)) } } }}>Удалить</button>
          </div>
        </article>)}</div> : <div className="empty-state"><span className="empty-icon">▤</span><h2>{archiveQuery ? 'Ничего не найдено' : t.empty}</h2><p>{archiveQuery ? 'Попробуйте другой запрос.' : 'Создайте первый план, и он сохранится в вашем архиве.'}</p>{!archiveQuery && <button className="button primary" onClick={() => startWizard()}>{t.start}<span>→</span></button>}</div>}
      </section>}

      {view === 'templates' && <section className="page-section"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ПЕРСОНАЛЬНЫЕ ФОРМАТЫ</div><h1>{t.templates}</h1><p>Сохраните школьный бланк и выберите его при создании КСП.</p></div></div><div className="upload-panel"><div className="upload-icon">↑</div><div><h2>Добавить шаблон</h2><p>DOCX, PDF, PNG или JPG · до 10 МБ</p></div><div className="upload-fields"><input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Название шаблона"/><label className={`button primary upload-button ${busy ? 'disabled' : ''}`}>{busy ? 'Загружаем…' : 'Выбрать файл'}<input type="file" accept=".docx,.pdf,.png,.jpg,.jpeg" onChange={handleUpload} disabled={busy}/></label></div></div><div className="notice"><b>Анализ формата</b><span>Для DOCX извлекаются текстовые блоки и таблицы, для PDF — текстовый слой. Шаблон передаётся AI как контекст, но файл экспорта пока оформляется по стандартному бланку. OCR изображений и ручное сопоставление полей будут добавлены позже.</span></div>{templates.length > 0 && <div className="template-list">{templates.map((item) => <article className="template-card" key={item.id}><span className="template-icon">▧</span><div><b>{item.name}</b><small>{item.file_type.toUpperCase()} · {item.template_structure?.analysis_status === 'extracted' ? `${item.template_structure.tables?.length || 0} таблиц обнаружено` : 'загружен'}</small></div><button className="danger-text" onClick={async () => { if (confirm('Удалить шаблон?')) { await api.deleteTemplate(item.id); setTemplates((list) => list.filter((x) => x.id !== item.id)) } }}>Удалить</button></article>)}</div>}</section>}

      {view === 'admin' && <section className="page-section admin-page"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ЗАЩИЩЁННЫЙ РАЗДЕЛ</div><h1>Администрирование</h1><p>Показатели работы, пользователи, подписки и платежи.</p></div><button className="button secondary" onClick={() => void refreshAdmin()} disabled={busy}>{busy ? 'Обновляем…' : 'Обновить ↻'}</button></div>{adminStats ? <div className="admin-stats">{[["Пользователи", adminStats.users_total, `Новые сегодня: ${adminStats.users_new_today}`], ["Активны за 30 дней", adminStats.users_active_30d, `Заблокировано: ${adminStats.users_blocked}`], ["Генерации", adminStats.generations_total, `Сегодня: ${adminStats.generations_today} · месяц: ${adminStats.generations_month}`], ["Бесплатные / платные", `${adminStats.generations_free} / ${adminStats.generations_paid}`, `КСП всего: ${adminStats.lessons_total}`], ["Подписки", adminStats.active_subscriptions, `Месячные: ${adminStats.monthly_subscriptions} · годовые: ${adminStats.yearly_subscriptions}`], ["Платежи", `${adminStats.payments_success} успешных`, `Ожидают: ${adminStats.payments_pending} · ошибка: ${adminStats.payments_failed}`], ["Сумма успешных", `${adminStats.payments_amount} ₸`, "KZT"], ["AI-запросы", adminStats.ai_requests, `Ошибки: ${adminStats.ai_errors} · токены: ${(adminStats.ai_prompt_tokens + adminStats.ai_completion_tokens).toLocaleString()}`], ["Стоимость AI", `${adminStats.ai_cost.toFixed(4)}`, "OpenRouter"]].map(([title, value, detail]) => <article className="admin-stat" key={String(title)}><small>{title}</small><b>{value}</b><span>{detail}</span></article>)}</div> : <div className="empty-state"><p>Нажмите «Обновить», чтобы загрузить административные данные.</p><button className="button primary" onClick={() => void refreshAdmin()}>Загрузить сводку</button></div>}
        <div className="admin-section-title"><div><div className="eyebrow">АККАУНТЫ</div><h2>Пользователи</h2></div><span className="muted">{adminUsers.length} записей</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Пользователь / Telegram ID</th><th>Бесплатные</th><th>Подписка</th><th>Управление</th></tr></thead><tbody>{adminUsers.map((person) => <tr key={person.id}><td><b>{[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Пользователь'}</b><small>{person.telegram_user_id}{person.is_admin ? ' · администратор' : ''}</small></td><td>{person.free_generations}</td><td>{person.subscription_status === 'active' ? `${person.subscription_type || ''} · ${person.subscription_end ? new Date(person.subscription_end).toLocaleDateString() : 'активна'}` : 'Бесплатный'}</td><td><div className="admin-actions"><button onClick={async () => { try { setAdminDetail(await api.adminUser(person.id)) } catch (e) { setError(errorMessage(e)) } }}>Профиль</button><button onClick={() => void adminAction(() => api.adminCredits(person.id))}>+3 генерации</button><button onClick={() => void adminAction(() => api.adminSubscription(person.id, 'monthly'))}>Месяц</button><button onClick={() => void adminAction(() => api.adminSubscription(person.id, 'yearly'))}>Год</button><button className="danger-text" disabled={person.id === user.id && !person.is_blocked} onClick={() => void adminAction(() => api.adminBlock(person.id, !person.is_blocked))}>{person.is_blocked ? 'Разблокировать' : 'Блокировать'}</button></div></td></tr>)}</tbody></table></div>
        <div className="admin-section-title"><div><div className="eyebrow">ОПЛАТА</div><h2>Последние платежи</h2></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Дата</th><th>Тариф</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{adminPayments.slice(0, 20).map((payment) => <tr key={payment.id}><td>{new Date(payment.created_at).toLocaleString()}</td><td>{payment.tariff === 'yearly' ? 'Годовой' : 'Месячный'}</td><td>{payment.amount} {payment.currency}</td><td><span className={`status-pill ${payment.status}`}>{payment.status}</span></td></tr>)}</tbody></table></div>
      </section>}

      {view === 'tariff' && <section className="page-section tariff-page">
        <div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ПОДДЕРЖКА ВАШЕЙ РАБОТЫ</div><h1>{t.tariff}</h1><p>Выберите подходящий объём доступа к генератору.</p></div></div>
        {usage?.subscription_active && <div className="active-banner"><span>✓</span><div><b>Подписка активна</b><small>Доступ до {due}</small></div></div>}
        <div className="tariff-grid">
          <article className="tariff-card"><span className="tariff-label">СТАРТ</span><h2>Бесплатный</h2><div className="price">0 ₸ <small>/ всегда</small></div><p>Попробуйте создание КСП с помощью AI.</p><ul><li>3 генерации</li><li>Сохранение планов</li><li>Экспорт в DOCX</li></ul><button className="button secondary full-width" onClick={() => startWizard()}>Продолжить бесплатно</button></article>
          <article className="tariff-card featured"><span className="recommended">ПОПУЛЯРНЫЙ</span><span className="tariff-label">МЕСЯЦ</span><h2>Месячный</h2><div className="price">750 ₸ <small>/ месяц</small></div><p>Продолжайте создавать планы весь месяц.</p><ul><li>Генерации по подписке</li><li>Все функции КСП</li><li>Подписка на 30 дней</li></ul>{subscriptionInfo?.payments_available ? <button className="button primary full-width" onClick={() => void createPayment('monthly')} disabled={busy}>Тестовый платёж на месяц <span>→</span></button> : <button className="button secondary full-width" disabled>Оплата пока недоступна</button>}</article>
          <article className="tariff-card"><span className="tariff-label">ГОД</span><h2>Годовой</h2><div className="price">5500 ₸ <small>/ год</small></div><p>Годовой доступ по более выгодной цене.</p><ul><li>Генерации по подписке</li><li>Все функции КСП</li><li>Подписка на 365 дней</li></ul>{subscriptionInfo?.payments_available ? <button className="button secondary full-width" onClick={() => void createPayment('yearly')} disabled={busy}>Тестовый платёж на год <span>→</span></button> : <button className="button secondary full-width" disabled>Оплата пока недоступна</button>}</article>
        </div>
        <p className="test-note"><span>ⓘ</span>{subscriptionInfo?.test_mode_available ? 'Тестовая симуляция включена только для локальной разработки; реальные списания не выполняются.' : 'Реальный платёжный провайдер ещё не подключён. Оплата в production недоступна.'}</p>
        {paymentId && subscriptionInfo?.test_mode_available && (
          <div className="payment-test"><b>Тестовый платёж создан</b><span>Симуляция проверяет только сценарий подписки.</span><div>
            <button className="button primary" onClick={async () => { try { await api.simulatePayment(paymentId, 'success'); setPaymentId(''); await refresh(); setToast('Подписка активирована') } catch (error) { setError(errorMessage(error)) } }}>Симулировать успех</button>
            <button className="button secondary" onClick={async () => { try { await api.simulatePayment(paymentId, 'failed'); setPaymentId(''); setToast('Платёж отмечен как неуспешный') } catch (error) { setError(errorMessage(error)) } }}>Симулировать ошибку</button>
            <button className="text-button" onClick={async () => { try { await api.simulatePayment(paymentId, 'pending'); setToast('Платёж ожидает подтверждения') } catch (error) { setError(errorMessage(error)) } }}>Оставить ожидающим</button>
          </div></div>
        )}
      </section>}

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
  function field<K extends keyof Lesson['content_json']>(key: K, value: Lesson['content_json'][K]) { onChange({ ...content, [key]: value }) }
  const stages = (index: number, key: keyof Stage, value: string) => field('stages', content.stages.map((stage, i) => i === index ? { ...stage, [key]: value } : stage))
  return <div className="document-wrap"><div className="document-title">{content.title}</div><div className="document-subtitle">____________________________<br/><small>{content.language === 'kk' ? '(сабақ тақырыбы)' : '(тема урока)'}</small></div>
    <div className="ksp-meta">
      <div className="meta-section"><strong>{content.language === 'kk' ? 'Бөлім:' : 'Раздел:'}</strong><input aria-label={content.language === 'kk' ? 'Бөлім' : 'Раздел'} value={content.section} onChange={(e) => field('section', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Педагогтің аты-жөні:' : 'ФИО педагога:'}</div><div className="meta-value wide"><input value={content.teacher_name} onChange={(e) => field('teacher_name', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Күні:' : 'Дата:'}</div><div className="meta-value wide"><input value={content.date} onChange={(e) => field('date', e.target.value)} /></div>
      <div className="meta-value">{content.language === 'kk' ? 'Сынып:' : 'Класс:'} <input aria-label={content.language === 'kk' ? 'Сынып' : 'Класс'} value={content.class_name} onChange={(e) => field('class_name', e.target.value)} /></div><div className="meta-value">{content.language === 'kk' ? 'Қатысқандар саны:' : 'Количество присутствующих:'} <input type="number" value={content.present_count} onChange={(e) => field('present_count', Number(e.target.value))} /></div><div className="meta-value">{content.language === 'kk' ? 'Қатыспағандар саны:' : 'Количество отсутствующих:'} <input type="number" value={content.absent_count} onChange={(e) => field('absent_count', Number(e.target.value))} /></div>
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

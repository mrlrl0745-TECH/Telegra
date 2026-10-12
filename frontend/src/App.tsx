import { LessonChat, type ChatLessonInput } from './components/LessonChat'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, AdminStats, getToken, Lesson, Stage, SubscriptionInfo, TeacherProfile, Template, Usage, User, setToken } from './api'
import WebApp from '@twa-dev/sdk'
import { IconArrowRight, IconCheck, IconFileText, IconLayoutGrid, IconSearch, IconSparkles, IconUpload, IconUserCircle } from '@tabler/icons-react'
import { Dashboard, DocumentPreview, Modal, Navigation } from './components/Workspace'

type View = 'home' | 'wizard' | 'lessons' | 'templates' | 'tariff' | 'help' | 'preview' | 'admin' | 'profile'
type Language = 'ru' | 'kk'
const appRole = import.meta.env.VITE_APP_ROLE
const isUserFrontend = appRole === 'USER'
type AdminPayment = { id: string; amount: number; currency: string; status: string; tariff: string; created_at: string }
type AdminDetail = { user: User; payments: AdminPayment[]; subscriptions: { id: string; type: string; status: string; start_date: string | null; end_date: string | null }[] }
type FormData = {
  teacher_name: string; lesson_date: string; subject: string; section: string; grade: string; present_count: number | ''; absent_count: number | ''; topic: string
  learning_objectives: string[]; lesson_objectives: string[]; lesson_duration: number; lesson_type: string; class_level: string; students_count: number
  language: Language; difficulty: string; work_formats: string[]; pair_work: boolean; group_work: boolean; individual_work: boolean; differentiation: boolean
  homework_required: boolean; reflection_required: boolean; interactive_tasks: boolean; substitute_mode: boolean; additional_requirements: string; template_id: string | null
}

const classSizes: Record<string, number> = { "5": 24, "6": 26, "7": 28, "8": 25, "9": 22, "10": 20, "11": 18 }
const ktpSections: Record<string, string> = {
  'обыкновенные дроби': 'Рациональные выражения',
  'дроб': 'Рациональные выражения',
  'рациональн': 'Рациональные выражения',
  'уравнен': 'Уравнения и неравенства',
  'процент': 'Числа и величины',
  'функц': 'Функции и их графики',
  'геометр': 'Геометрические фигуры',
  'вероятност': 'Элементы комбинаторики и теории вероятностей',
  'многочлен': 'Алгебраические выражения',
}
const defaultKtpSections: Record<string, string> = {
  'Математика': 'Числа и математические выражения',
  'Математика (алгебра)': 'Алгебраические выражения',
  'Математика (геометрия)': 'Геометрические фигуры и их свойства',
  'Казахский язык': 'Языковые нормы и речевая деятельность',
  'Қазақ тілі': 'Тілдік нормалар және сөйлеу әрекеті',
  'Русский язык': 'Языковые нормы и речевая деятельность',
  'Английский язык': 'Коммуникация и языковые навыки',
  'Информатика': 'Информация и цифровые технологии',
  'Физика': 'Физические явления и законы',
  'Химия': 'Вещества и химические реакции',
  'Биология': 'Живые организмы и биологические процессы',
  'История Казахстана': 'История Казахстана',
  'Қазақстан тарихы': 'Қазақстан тарихы',
  'География': 'Географические закономерности и процессы',
}
function localToday() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
function readLanguagePreference(): Language | null {
  try {
    const saved = localStorage.getItem('ksp_language')
    return saved === 'ru' || saved === 'kk' ? saved : null
  } catch { return null }
}
function saveLanguagePreference(value: Language) {
  try { localStorage.setItem('ksp_language', value) } catch { /* Language remains selected for this session. */ }
}
const initialForm: FormData = { teacher_name: '', lesson_date: localToday(), subject: '', section: '', grade: '', present_count: '', absent_count: '', topic: '', learning_objectives: [''], lesson_objectives: [''], lesson_duration: 45, lesson_type: 'Комбинированный урок', class_level: 'Средний', students_count: 0, language: 'ru', difficulty: 'Средний', work_formats: [], pair_work: false, group_work: false, individual_work: true, differentiation: false, homework_required: true, reflection_required: true, interactive_tasks: false, substitute_mode: false, additional_requirements: '', template_id: null }
const copy = {
  ru: { create: 'Создать КСП', mine: 'Мои КСП', templates: 'Мои шаблоны', tariff: 'Мой тариф', help: 'Помощь', remaining: 'Бесплатных генераций', activeUntil: 'Подписка активна до', subtitle: 'Готовый поурочный план по вашему шаблону — за несколько минут.', start: 'Начать создание', welcome: 'Добро пожаловать', step: 'Шаг', back: 'Назад', next: 'Далее', generate: 'Сформировать КСП', generating: 'Формируем ваш план…', standard: 'Объединённый шаблон КСП', upload: 'Загрузить свой шаблон', save: 'Сохранить изменения', download: 'Скачать DOCX', regenerate: 'Создать другой вариант', empty: 'Пока нет сохранённых КСП', close: 'Закрыть', cancel: 'Отмена', preview: 'Предпросмотр', subscribe: 'Выбрать тариф', language: 'Язык КСП', homeEyebrow: 'ПЛАН УРОКА · КАЗАХСТАН', workspaceEyebrow: 'ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО', workspaceTitle: 'Всё для урока', documents: 'документов', savedPlans: 'сохранённых планов', createCardTitle: 'Новый КСП', createCardDescription: 'Тема, класс, предмет и цель в одном экране', substituteTitle: 'Учитель на замене', substituteDescription: 'Быстрый план только по классу, предмету и теме', templateDescription: 'Ваши форматы документов', tariffDescription: 'Тарифы и история оплаты', helpDescription: 'Как подготовить КСП', adminTitle: 'Администрирование', adminDescription: 'Статистика и пользователи', profileShortcut: 'Профиль', yearlyTariff: 'Годовой тариф', monthlyTariff: 'Месячный тариф', freeOf: 'из', freeAvailableLabel: 'доступно', profileEyebrow: 'ВАШИ ДАННЫЕ', profileTitle: 'Профиль учителя', profileDescription: 'Предметы и классы будут доступны для выбора при создании каждого КСП.', fullName: 'Фамилия, имя и отчество', classes: 'Какие классы ведёте?', classesHint: 'Добавьте каждый класс отдельно, например: 5А, 7Б', subjects: 'Какие предметы преподаёте?', subjectsHint: 'Добавьте каждый предмет отдельно', classPlaceholder: 'Класс', subjectPlaceholder: 'Предмет', addClass: 'Добавить класс', addSubject: 'Добавить предмет', removeClass: 'Удалить класс', removeSubject: 'Удалить предмет', saveProfile: 'Сохранить профиль' },
  kk: { create: 'ҚМЖ құру', mine: 'Менің ҚМЖ-ларым', templates: 'Менің үлгілерім', tariff: 'Менің тарифім', help: 'Көмек', remaining: 'Тегін генерация қалды', activeUntil: 'Жазылым мерзімі', subtitle: 'Үлгіңізге сай дайын сабақ жоспары — бірнеше минутта.', start: 'Құруды бастау', welcome: 'Қош келдіңіз', step: 'Қадам', back: 'Артқа', next: 'Келесі', generate: 'ҚМЖ жасау', generating: 'Жоспар жасалуда…', standard: 'Стандартты үлгі', upload: 'Үлгі жүктеу', save: 'Өзгерістерді сақтау', download: 'DOCX жүктеу', regenerate: 'Басқа нұсқа жасау', empty: 'Сақталған ҚМЖ жоқ', close: 'Жабу', cancel: 'Бас тарту', preview: 'Алдын ала көру', language: 'ҚМЖ тілі', subscribe: 'Тариф таңдау', homeEyebrow: 'САБАҚ ЖОСПАРЫ · ҚАЗАҚСТАН', workspaceEyebrow: 'СІЗДІҢ ЖҰМЫС ОРНЫҢЫЗ', workspaceTitle: 'Сабаққа қажеттінің бәрі', documents: 'құжат', savedPlans: 'сақталған жоспар', createCardTitle: 'Жаңа ҚМЖ', createCardDescription: 'Тақырып, сынып, пән және мақсат бір экранда', substituteTitle: 'Орнындағы мұғалім', substituteDescription: 'Сынып, пән және тақырып бойынша жедел жоспар', templateDescription: 'Құжат пішімдеріңіз', tariffDescription: 'Тарифтер мен төлем тарихы', helpDescription: 'ҚМЖ дайындау жолы', adminTitle: 'Әкімші бөлімі', adminDescription: 'Статистика және пайдаланушылар', profileShortcut: 'Профиль', yearlyTariff: 'Жылдық тариф', monthlyTariff: 'Айлық тариф', freeOf: 'ішінен', freeAvailableLabel: 'қолжетімді', profileEyebrow: 'ЖЕКЕ ДЕРЕКТЕРІҢІЗ', profileTitle: 'Мұғалім профилі', profileDescription: 'Пәндеріңіз бен сыныптарыңыз әр ҚМЖ жасағанда таңдауға қолжетімді болады.', fullName: 'Тегі, аты және әкесінің аты', classes: 'Қай сыныптарға сабақ бересіз?', classesHint: 'Әр сыныпты бөлек қосыңыз, мысалы: 5А, 7Б', subjects: 'Қандай пәндерден сабақ бересіз?', subjectsHint: 'Әр пәнді бөлек қосыңыз', classPlaceholder: 'Сынып', subjectPlaceholder: 'Пән', addClass: 'Сынып қосу', addSubject: 'Пән қосу', removeClass: 'Сыныпты жою', removeSubject: 'Пәнді жою', saveProfile: 'Профильді сақтау' },
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Не удалось выполнить запрос' }
function httpStatus(error: unknown) { return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined }
function defaultContent(lesson: Lesson): Lesson['content_json'] { return structuredClone(lesson.content_json) }
function safeFilename(value: string) { return value.slice(0, 45).replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '') || 'ksp' }
function deliverFile(blob: Blob, filename: string, iosWindow: Window | null) {
  const href = URL.createObjectURL(blob)
  if (iosWindow) {
    // iOS WebViews ignore the download attribute; open the file in a tab reserved by the tap.
    iosWindow.location.href = href
  } else {
    const link = document.createElement('a')
    link.href = href
    link.download = filename
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
  }
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [profileNameInput, setProfileNameInput] = useState('')
  const [profileClassesInput, setProfileClassesInput] = useState<string[]>([''])
  const [profileSubjectsInput, setProfileSubjectsInput] = useState<string[]>([''])
  const [teacherExtras, setTeacherExtras] = useState(() => {
    try { return JSON.parse(localStorage.getItem('teacher_profile_extras') || '{}') as { school?: string; category?: string; experience?: string } }
    catch { return {} as { school?: string; category?: string; experience?: string } }
  })
  const languageInitialized = useRef(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null)
  const [view, setView] = useState<View>('home')
  const [wizardStep, setWizardStep] = useState(0)
  const [generating, setGenerating] = useState(false)
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
  const kspTemplateInput = useRef<HTMLInputElement>(null)
  const t = copy[language]
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
      const accountName = [currentUser.first_name, currentUser.last_name].filter(Boolean).join(' ')
      setProfileNameInput(accountName === 'Тестовый пользователь' ? '' : accountName)
    }
    if (!languageInitialized.current) {
      setLanguage(readLanguagePreference() || (currentUser.language.toLowerCase().startsWith('kk') ? 'kk' : 'ru'))
      languageInitialized.current = true
    }
  }, [])

  useEffect(() => {
    const redirectUserAdminPath = () => {
      if (isUserFrontend && window.location.pathname.startsWith('/admin')) window.history.replaceState(null, '', '/')
    }
    redirectUserAdminPath()
    window.addEventListener('popstate', redirectUserAdminPath)
    return () => window.removeEventListener('popstate', redirectUserAdminPath)
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
    // WebViews may resize only the visual viewport when the software keyboard opens.
    const viewport = window.visualViewport
    const updateKeyboard = () => {
      const editing = document.activeElement?.matches('input, textarea, select')
      const height = viewport?.height || window.innerHeight
      document.documentElement.dataset.keyboard = editing && window.innerHeight - height > 120 ? 'open' : 'closed'
    }
    viewport?.addEventListener('resize', updateKeyboard)
    document.addEventListener('focusin', updateKeyboard)
    document.addEventListener('focusout', updateKeyboard)
    return () => {
      viewport?.removeEventListener('resize', updateKeyboard)
      document.removeEventListener('focusin', updateKeyboard)
      document.removeEventListener('focusout', updateKeyboard)
    }
  }, [])
  useEffect(() => {
    const handleBack = () => { if (view === 'wizard' && wizardStep > 0) setWizardStep((step) => step - 1); else setView((current) => current === 'preview' ? 'lessons' : 'home') }
    if (view === 'home') { WebApp.BackButton.hide(); return }
    WebApp.BackButton.onClick(handleBack)
    WebApp.BackButton.show()
    return () => { WebApp.BackButton.offClick(handleBack); WebApp.BackButton.hide() }
  }, [view, wizardStep])
  useEffect(() => {
    const submit = () => document.querySelector<HTMLFormElement>('#ksp-form')?.requestSubmit()
    if (view !== 'wizard' || !teacherProfile) { WebApp.MainButton.hide(); return }
    WebApp.MainButton.setText(busy ? (language === 'kk' ? 'Жоспар жасалуда…' : 'Формируем КСП…') : wizardStep < 2 ? t.next : t.generate)
    WebApp.MainButton.setParams({ is_visible: true, is_active: !busy })
    if (busy) WebApp.MainButton.showProgress()
    else WebApp.MainButton.hideProgress()
    WebApp.MainButton.onClick(submit)
    WebApp.MainButton.show()
    return () => { WebApp.MainButton.offClick(submit); WebApp.MainButton.hide(); WebApp.MainButton.hideProgress() }
  }, [busy, language, t.generate, t.next, view, wizardStep, teacherProfile])
  useEffect(() => {
    if (isDirty && (view === 'home' || view === 'wizard' || view === 'preview')) WebApp.enableClosingConfirmation()
    else WebApp.disableClosingConfirmation()
  }, [isDirty, view])

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }) }, [view, wizardStep])

  const startWizard = (keepDraft = false, source?: Lesson, forSubstitute = false) => {
    let draftIsSubstitute = false
    if (keepDraft) {
      try { const saved: unknown = JSON.parse(sessionStorage.getItem('ksp_draft') || '{}'); const savedForm = typeof saved === 'object' && saved !== null && 'form' in saved ? saved.form : undefined; draftIsSubstitute = typeof saved === 'object' && saved !== null && 'substituteMode' in saved && saved.substituteMode === true; setForm({ ...initialForm, ...(typeof savedForm === 'object' && savedForm !== null ? savedForm : {}) } as FormData) } catch { setForm(initialForm) }
    } else {
      const recent = source || (forSubstitute ? undefined : lessons[0])
      const profileName = teacherProfile?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ')
      setForm({
        ...initialForm,
        teacher_name: profileName || recent?.teacher_name || 'Учитель на замене',
        lesson_date: localToday(), subject: recent?.subject || teacherProfile?.subjects[0] || '', grade: recent?.grade || teacherProfile?.classes[0] || '', section: source?.section || '',
        topic: source?.topic || '', language: recent?.language === 'kk' ? 'kk' : language,
        learning_objectives: source ? [...source.learning_objectives] : [''],
        lesson_objectives: source ? [...source.lesson_objectives] : [''],
        lesson_duration: source?.content_json.lesson_duration || 45,
      })
      sessionStorage.removeItem('ksp_draft')
    }
    setSubstituteMode(keepDraft ? draftIsSubstitute : forSubstitute)
    setIsDirty(false)
    setError(''); setWizardStep(0); setView('wizard'); setResumeDraft(false)
  }
  const updateForm = <K extends keyof FormData>(key: K, value: FormData[K]) => { setIsDirty(true); setForm((previous) => ({ ...previous, [key]: value })) }
  const tapChoice = () => { try { WebApp.HapticFeedback.selectionChanged() } catch { /* outside Telegram */ } }
  const changeLanguage = (value: Language) => { setLanguage(value); saveLanguagePreference(value) }
  const saveDraft = () => { sessionStorage.setItem('ksp_draft', JSON.stringify({ form, substituteMode })); setToast('Черновик сохранён') }
  const generate = async (event?: FormEvent) => {
    event?.preventDefault()
    const learningObjectives = form.learning_objectives.map((value) => value.trim()).filter(Boolean)
    const lessonObjectives = form.lesson_objectives.map((value) => value.trim()).filter(Boolean)
    const topic = form.topic.trim()
    const section = form.section.trim()
    if (!form.subject.trim() || !form.grade.trim() || !topic || !section) {
      setError(language === 'kk'
        ? (!topic ? 'Сабақ тақырыбын енгізіңіз.' : 'Бөлімді енгізіңіз немесе автоматты таңдалған бөлімді түзетіңіз.')
        : (!topic ? 'Укажите тему урока.' : 'Укажите раздел программы или исправьте автоматически подобранный раздел.'))
      return
    }
    setBusy(true); setGenerating(true); setError('')
    try {
      const generated = await api.generate({
        ...form, present_count: classSizes[form.grade.match(/^\s*(\d+)/)?.[1] || form.grade.match(/\d/)?.[0] || ''] || 25, absent_count: 0, substitute_mode: substituteMode, teacher_name: form.teacher_name.trim() || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Учитель на замене',
        lesson_date: form.lesson_date || localToday(), section,
        topic: topic.slice(0, 300), learning_objectives: learningObjectives, lesson_objectives: lessonObjectives,
      })
      setActive(generated); setContent(defaultContent(generated)); setView('preview'); setIsDirty(false); sessionStorage.removeItem('ksp_draft'); WebApp.HapticFeedback.notificationOccurred('success')
      // Do not keep the generation spinner visible while unrelated profile and archive data refresh.
      void refresh().catch((refreshError: unknown) => setError(errorMessage(refreshError)))
    } catch (e) { setError(errorMessage(e)); if (httpStatus(e) === 402) setView('tariff'); WebApp.HapticFeedback.notificationOccurred('error') }
    finally { setBusy(false); setGenerating(false) }
  }
  const generateFromChat = async (input: ChatLessonInput) => {
    const generated = await api.generate({
      ...initialForm, teacher_name: teacherProfile?.full_name || user?.first_name || 'Учитель',
      lesson_date: localToday(), language, topic: input.topic, subject: input.subject, grade: input.grade,
      section: sectionFor(input.topic, input.subject, input.grade) || input.topic,
      present_count: input.present, absent_count: input.absent, students_count: input.present + input.absent,
      learning_objectives: [], lesson_objectives: [],
    })
    setLessons(current => [generated, ...current.filter(item => item.id !== generated.id)])
    void api.usage().then(setUsage).catch(() => undefined)
    return generated
  }
  const createTasks = async (lesson: Lesson) => {
    const updated = await api.practiceTasks(lesson.id)
    setLessons(current => current.map(item => item.id === updated.id ? updated : item))
    if (active?.id === updated.id && !isDirty) { setActive(updated); setContent(defaultContent(updated)) }
    void api.usage().then(setUsage).catch(() => undefined)
    return updated
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
    const iosWindow = /iPad|iPhone|iPod/i.test(navigator.userAgent) ? window.open('about:blank', '_blank') : null
    try { const saved = await persistPendingChanges(lesson); const blob = await api.exportDocx(saved.id); deliverFile(blob, `ksp-${safeFilename(saved.topic)}.docx`, iosWindow) }
    catch (e) { iosWindow?.close(); setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const downloadPdf = async (lesson: Lesson) => {
    setBusy(true)
    const iosWindow = /iPad|iPhone|iPod/i.test(navigator.userAgent) ? window.open('about:blank', '_blank') : null
    try { const saved = await persistPendingChanges(lesson); const blob = await api.exportPdf(saved.id); deliverFile(blob, `ksp-${safeFilename(saved.topic)}.pdf`, iosWindow) }
    catch (e) { iosWindow?.close(); setError(errorMessage(e)) } finally { setBusy(false) }
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
      localStorage.setItem('teacher_profile_extras', JSON.stringify(teacherExtras))
      setTeacherProfile(saved); setProfileLoaded(true); setProfileNameInput(saved.full_name)
      setProfileClassesInput(saved.classes); setProfileSubjectsInput(saved.subjects)
      setToast(language === 'kk' ? 'Профиль сақталды' : 'Профиль сохранён'); WebApp.HapticFeedback.notificationOccurred('success')
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
  const handleKspTemplateUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) { setError('Выберите файл DOCX.'); event.target.value = ''; return }
    setBusy(true); setError('')
    try {
      const item = await api.uploadTemplate(file.name.replace(/\.docx$/i, '') || 'Шаблон педагога', file)
      setTemplates((list) => [item, ...list]); updateForm('template_id', item.id); setToast('Шаблон загружен и выбран')
    } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false); event.target.value = '' }
  }
  const sectionFor = (topic: string, subject: string, grade: string) => {
    const normalizedTopic = topic.trim().toLocaleLowerCase('ru')
    const savedMatch = lessons.find((lesson) => lesson.topic.trim().toLocaleLowerCase('ru') === normalizedTopic && lesson.subject === subject && lesson.grade === grade && lesson.section.trim())
    const gradeMatch = lessons.find((lesson) => lesson.grade === grade && lesson.subject === subject && lesson.section.trim())
    const topicSection = Object.entries(ktpSections).find(([key]) => normalizedTopic.includes(key))?.[1]
    return savedMatch?.section || gradeMatch?.section || topicSection || defaultKtpSections[subject] || ''
  }
  const updateGrade = (grade: string) => {
    updateForm('grade', grade)
    // A grade does not identify an official programme objective; never invent its code.
    if (grade !== form.grade) updateForm('learning_objectives', [''])
    updateForm('section', sectionFor(form.topic, form.subject, grade))
  }
  const updateTopic = (topic: string) => {
    updateForm('topic', topic)
    updateForm('section', sectionFor(topic, form.subject, form.grade))
  }
  const chooseDownload = (lesson: Lesson) => void download(lesson)
  const due = usage?.subscription_end ? new Date(usage.subscription_end).toLocaleDateString(language === 'kk' ? 'kk-KZ' : 'ru-RU') : ''

  if (!user) return <SplashScreen message={language === 'kk' ? 'Қауіпсіз сессияға қосылуда…' : 'Подключаем защищённую сессию…'} error={error} language={language} onRetry={() => window.location.reload()} />

  if (!profileLoaded) return <SplashScreen message={language === 'kk' ? 'Мұғалім профилі жүктелуде…' : 'Загружаем профиль учителя…'} language={language} />

  if (!teacherProfile) return <main className="auth-shell onboarding-shell"><form className="form-container fade-in" onSubmit={(event) => void saveTeacherProfile(event)}>
    <div className="onboarding-language lang-switch" aria-label={language === 'kk' ? 'Интерфейс тілі' : 'Язык интерфейса'}><button type="button" className={language === 'ru' ? 'selected' : ''} onClick={() => changeLanguage('ru')}>RU</button><button type="button" className={language === 'kk' ? 'selected' : ''} onClick={() => changeLanguage('kk')}>KZ</button></div>
    <h1 className="form-title"><span className="icon-box"><IconUserCircle size={24}/></span>{language === 'kk' ? 'Профиліңізді баптайық' : 'Давайте настроим ваш профиль'}</h1>
    <div className="form-group"><label className="form-label">{language === 'kk' ? 'Тегі, аты, әкесінің аты' : t.fullName}</label><input className="input-theme" required minLength={3} maxLength={200} autoComplete="name" value={profileNameInput} onChange={(event) => setProfileNameInput(event.target.value)} placeholder={language === 'kk' ? 'Ахметов Асан Болатович' : 'Иванов Иван Иванович'} /></div>
    <div className="form-group"><label className="form-label">{language === 'kk' ? 'Мектеп' : 'Школа'}</label><input className="input-theme" value={teacherExtras.school || ''} onChange={(event) => setTeacherExtras((value) => ({ ...value, school: event.target.value }))} placeholder={language === 'kk' ? 'Мектеп атауы' : 'Название школы'} /></div>
    <div className="grid-2 form-group"><div><label className="form-label">{language === 'kk' ? 'Санат' : 'Категория'}</label><input className="input-theme" value={teacherExtras.category || ''} onChange={(event) => setTeacherExtras((value) => ({ ...value, category: event.target.value }))} placeholder={language === 'kk' ? 'Педагог-модератор' : 'Педагог-модератор'} /></div><div><label className="form-label">{language === 'kk' ? 'Еңбек өтілі' : 'Стаж'}</label><input className="input-theme" type="number" min="0" max="60" value={teacherExtras.experience || ''} onChange={(event) => setTeacherExtras((value) => ({ ...value, experience: event.target.value }))} placeholder="0" /></div></div>
    <div className="form-group"><label className="form-label">{language === 'kk' ? 'Оқытатын пәндеріңіз' : 'Предметы, которые вы ведёте'}</label><div className="subject-grid">{(language === 'kk' ? ['Математика','Қазақ тілі','Орыс тілі','Ағылшын тілі','Информатика','Физика','Химия','Биология','Қазақстан тарихы','География'] : ['Математика','Казахский язык','Русский язык','Английский язык','Информатика','Физика','Химия','Биология','История Казахстана','География']).map((subject) => <button key={subject} type="button" aria-pressed={profileSubjectsInput.includes(subject)} className={`tile-button ${profileSubjectsInput.includes(subject) ? 'active' : ''}`} onClick={() => { tapChoice(); setProfileSubjectsInput((values) => values.includes(subject) ? values.filter((item) => item !== subject) : [...values.filter(Boolean), subject]) }}>{subject}</button>)}</div><div className="onboarding-list">{profileSubjectsInput.map((value, index) => (!value || !((language === 'kk' ? ['Математика','Қазақ тілі','Орыс тілі','Ағылшын тілі','Информатика','Физика','Химия','Биология','Қазақстан тарихы','География'] : ['Математика','Казахский язык','Русский язык','Английский язык','Информатика','Физика','Химия','Биология','История Казахстана','География']).includes(value))) ? <input className="input-theme" key={`custom-subject-${index}`} value={value} onChange={(event) => setProfileSubjectsInput((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={language === 'kk' ? 'Басқа пән' : 'Другой предмет'} /> : null)}</div><button type="button" className="onboarding-add" onClick={() => setProfileSubjectsInput((items) => [...items, ''])}>＋ {language === 'kk' ? 'Басқа пән' : 'Добавить другой предмет'}</button></div>
    <div className="form-group"><label className="form-label">{language === 'kk' ? 'Сынып параллельдері' : 'Параллели классов'}</label><div className="grade-grid">{Array.from({ length: 11 }, (_, index) => String(index + 1)).map((grade) => { const selected = profileClassesInput.some((value) => value === grade || value.startsWith(`${grade} `) || value.startsWith(`${grade} класс`)); return <button key={grade} type="button" aria-pressed={selected} aria-label={`${grade} ${language === 'kk' ? 'сынып' : 'класс'}`} className={`tile-button tile-center grade-chip ${selected ? 'active' : ''}`} onClick={() => { tapChoice(); setProfileClassesInput((values) => selected ? values.filter((value) => value !== grade && !value.startsWith(`${grade} `) && !value.startsWith(`${grade} класс`)) : [...values.filter(Boolean), grade]) }}>{grade}</button> })}</div><small>{language === 'kk' ? 'Қажет болса, сынып әрпін профильде нақтылай аласыз.' : 'При необходимости букву класса можно уточнить в профиле.'}</small></div>
    {error && <div className="alert" role="alert">{error}</div>}<button className="submit-btn" type="submit" disabled={busy || !profileSubjectsInput.some(Boolean) || !profileClassesInput.some(Boolean)}>{busy ? (language === 'kk' ? 'Сақталуда…' : 'Сохраняем…') : (language === 'kk' ? 'Профильді сақтау және жалғастыру' : 'Сохранить профиль и продолжить')}</button>
  </form></main>

  return <div className="app-shell app-enter">
    <header className="topbar"><button className="brand" onClick={() => setView('home')} aria-label={language === 'kk' ? 'Басты бет' : 'На главную'}><img src="/teacherbot.webp" width="44" height="44" alt=""/><span>Teacher<span className="brand-accent">Bot</span><small>{language === 'kk' ? 'Мұғалімнің көмекшісі' : 'Помощник преподавателя'}</small></span></button><form className="header-search" role="search" onSubmit={(event) => { event.preventDefault(); setView('lessons') }}><IconSearch size={20}/><input aria-label={language === 'kk' ? 'Құжаттарды іздеу' : 'Поиск документов'} value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} placeholder={language === 'kk' ? 'Тақырып, сынып, құжаттар бойынша іздеу…' : 'Поиск по темам, классам, документам…'}/><button type="submit" aria-label={language === 'kk' ? 'Іздеу' : 'Найти'}><IconArrowRight size={17}/></button></form><div className="top-actions"><button className="header-help" onClick={() => setView('help')} aria-label={t.help}>?</button><div className="lang-switch"><button className={language === 'ru' ? 'selected' : ''} onClick={() => changeLanguage('ru')}>RU</button><button className={language === 'kk' ? 'selected' : ''} onClick={() => changeLanguage('kk')}>KZ</button></div><button className="profile-shortcut" onClick={() => setView('profile')} aria-label={language === 'kk' ? 'Профильді ашу' : 'Открыть профиль'}><span className="profile-avatar">{(user.first_name || 'У').slice(0, 1).toUpperCase()}</span><span><b>{user.first_name}</b><small>{language === 'kk' ? 'Мұғалім' : 'Преподаватель'}</small></span></button></div></header>
    <main className="content view-enter">
      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть">×</button></div>}
      <div hidden={view !== 'home'}><Dashboard name={user.first_name || teacherProfile.full_name.split(' ')[0]} language={language} usage={usage} lessons={lessons} due={due} create={(substitute) => startWizard(false, undefined, substitute)} navigate={setView} openLesson={(lesson) => void openLesson(lesson)} downloadLesson={chooseDownload} chat={<LessonChat language={language} subjects={teacherProfile.subjects} classes={teacherProfile.classes} lessons={lessons} generate={generateFromChat} tasks={createTasks} open={(lesson) => void openLesson(lesson)} download={chooseDownload}/>}/></div>
      {view === 'wizard' && <section className="wizard-page">
        <div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← {language === 'kk' ? 'Басты бет' : 'Обзор'}</button><div className="eyebrow">{substituteMode ? (language === 'kk' ? 'ЖЕДЕЛ РЕЖИМ' : 'УРОК НА ЗАМЕНЕ') : (language === 'kk' ? 'ЖАҢА ҚҰЖАТ' : 'НОВЫЙ ДОКУМЕНТ')}</div><h1 tabIndex={-1}>{t.create}</h1><p>{language === 'kk' ? 'Сабақ жоспарын үш қадамда дайындаңыз.' : 'Три простых шага к продуманному уроку.'}</p></div><button className="button secondary" onClick={saveDraft} disabled={busy}>{language === 'kk' ? 'Жобаны сақтау' : 'Сохранить черновик'}</button></div>
        <ol className="wizard-steps" aria-label={language === 'kk' ? 'Қадамдар' : 'Этапы создания'}>{(language === 'kk' ? ['Сабақ туралы', 'Мақсат пен үлгі', 'Тексеру'] : ['Об уроке', 'Цели и шаблон', 'Проверка']).map((label, index) => <li key={label} className={index === wizardStep ? 'current' : index < wizardStep ? 'complete' : ''} aria-current={index === wizardStep ? 'step' : undefined}><span>{index < wizardStep ? <IconCheck size={16}/> : `0${index + 1}`}</span><b>{label}</b></li>)}</ol>
        <form id="ksp-form" className="wizard-form" onSubmit={(event) => { event.preventDefault(); if (wizardStep < 2) { setError(''); setWizardStep((step) => step + 1); tapChoice() } else void generate(event) }}>
          <fieldset hidden={wizardStep !== 0} disabled={wizardStep !== 0 || busy} className="step-fields">
            <div className="step-intro"><span className="eyebrow">01 / 03</span><h2>{language === 'kk' ? 'Қандай сабақ дайындаймыз?' : 'Какой урок готовим?'}</h2><p>{language === 'kk' ? 'Пәнді, сыныпты және тақырыпты таңдаңыз.' : 'Начните с предмета и класса, затем добавьте тему.'}</p></div>
          <div className="form-group"><div className="form-step"><span className="form-step-number">1</span>{language === 'kk' ? 'Пән' : 'Предмет'}</div><div className="subject-grid">{(teacherProfile?.subjects.length ? teacherProfile.subjects : (language === 'kk' ? ['Математика','Қазақ тілі','Орыс тілі','Ағылшын тілі','Информатика','Физика','Химия','Биология'] : ['Математика','Казахский язык','Русский язык','Английский язык','Информатика','Физика','Химия','Биология'])).map((subject) => <button key={subject} type="button" aria-pressed={form.subject === subject} className={`tile-button ${form.subject === subject ? 'active' : ''}`} onClick={() => { tapChoice(); updateForm('subject', subject); updateForm('section', sectionFor(form.topic, subject, form.grade)) }}>{subject}</button>)}</div><label className="sr-only" htmlFor="custom-subject">{language === 'kk' ? 'Басқа пән' : 'Другой предмет'}</label><input id="custom-subject" className="input-theme form-extra-input" value={teacherProfile?.subjects.includes(form.subject) ? '' : form.subject} onChange={(event) => { updateForm('subject', event.target.value); updateForm('section', sectionFor(form.topic, event.target.value, form.grade)) }} placeholder={language === 'kk' ? 'Немесе басқа пәнді енгізіңіз' : 'Или введите другой предмет'} required={!form.subject.trim()} /></div>
          <div className="form-group"><div className="form-step"><span className="form-step-number">2</span>{language === 'kk' ? 'Сынып' : 'Класс'}</div><div className="grade-grid">{(teacherProfile?.classes.length ? teacherProfile.classes : Array.from({ length: 11 }, (_, index) => String(index + 1))).map((grade) => <button key={grade} type="button" aria-pressed={form.grade === grade} aria-label={/^\d+$/.test(grade) ? `${grade} ${language === 'kk' ? 'сынып' : 'класс'}` : grade} className={`tile-button tile-center grade-chip ${form.grade === grade ? 'active' : ''}`} onClick={() => { tapChoice(); updateGrade(grade) }}>{grade}</button>)}</div><label className="sr-only" htmlFor="custom-grade">{language === 'kk' ? 'Басқа сынып' : 'Другой класс'}</label><input id="custom-grade" className="input-theme form-extra-input" value={(teacherProfile?.classes.includes(form.grade) || /^\d+$/.test(form.grade)) ? '' : form.grade} onChange={(event) => updateGrade(event.target.value)} placeholder={language === 'kk' ? 'Немесе сыныпты енгізіңіз, мысалы 7А' : 'Или укажите класс, например 7А'} required={!form.grade.trim()} /></div>
          <div className="form-group"><div className="form-step"><span className="form-step-number">3</span>{language === 'kk' ? 'Сабақ тақырыбы' : 'Тема урока'}</div><input className="input-theme" aria-label={language === 'kk' ? 'Сабақ тақырыбы' : 'Тема урока'} value={form.topic} onChange={(event) => updateTopic(event.target.value)} placeholder={language === 'kk' ? 'Тақырыпты енгізіңіз немесе таңдаңыз' : 'Введите или выберите тему'} required /></div>
          <div className="form-group"><div className="form-step"><span className="form-step-number">4</span>{language === 'kk' ? 'Бөлім' : 'Раздел программы'}</div><div className="form-selection"><input className="input-theme" value={form.section} onChange={(event) => updateForm('section', event.target.value)} placeholder={language === 'kk' ? 'Бөлімді енгізіңіз немесе таңдауды түзетіңіз' : 'Введите раздел или уточните автоподбор'} required maxLength={300} aria-label={language === 'kk' ? 'Бөлім' : 'Раздел программы'} /><span className="auto-badge">⚡ {form.section ? (language === 'kk' ? 'Өзгертуге болады' : 'Можно изменить') : (language === 'kk' ? 'Толтыру қажет' : 'Нужно заполнить')}</span></div></div>
          </fieldset>
          <fieldset hidden={wizardStep !== 1} disabled={wizardStep !== 1 || busy} className="step-fields">
            <div className="step-intro"><span className="eyebrow">02 / 03</span><h2>{language === 'kk' ? 'Мақсаттар мен құжат форматы' : 'Цели и формат документа'}</h2><p>{language === 'kk' ? 'Оқу мақсаттарын тексеріп, үлгіні таңдаңыз.' : 'Уточните цели из учебной программы и выберите подходящий бланк.'}</p></div>
            <ObjectiveEditor number="1" title={language === 'kk' ? 'Оқу мақсаттары' : 'Цели обучения'} helper={language === 'kk' ? 'Бағдарлама бойынша код пен тұжырым' : 'Код и формулировка по вашей программе'} values={form.learning_objectives} onChange={(values) => updateForm('learning_objectives', values)}/>
            <ObjectiveEditor number="2" title={language === 'kk' ? 'Сабақ мақсаттары' : 'Цели урока'} helper={language === 'kk' ? 'Қажет болса, күтілетін нәтижені нақтылаңыз' : 'При желании уточните ожидаемый результат'} values={form.lesson_objectives} onChange={(values) => updateForm('lesson_objectives', values)}/>
            <h3>{language === 'kk' ? 'Құжат үлгісі' : 'Шаблон документа'}</h3>
            <div className="template-picker"><button type="button" className={`template-option ${!form.template_id ? 'selected' : ''}`} aria-pressed={!form.template_id} onClick={() => { tapChoice(); updateForm('template_id', null) }}><DocumentPreview/><span><b>{t.standard}</b><small>{language === 'kk' ? 'Бастауға дайын' : 'Готов к использованию'}</small></span>{!form.template_id && <IconCheck size={19}/>}</button>
            {templates.map((item) => <button type="button" key={item.id} className={`template-option ${form.template_id === item.id ? 'selected' : ''}`} aria-pressed={form.template_id === item.id} onClick={() => { tapChoice(); updateForm('template_id', item.id) }}><DocumentPreview custom/><span><b>{item.name}</b><small>{item.file_type.toUpperCase()}</small></span>{form.template_id === item.id && <IconCheck size={19}/>}</button>)}
            <button type="button" className="template-option upload-option" onClick={() => kspTemplateInput.current?.click()}><IconUpload size={24}/><b>{t.upload}</b><small>DOCX</small></button></div>
            <input ref={kspTemplateInput} className="sr-only" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void handleKspTemplateUpload(event)}/>
          </fieldset>
          <fieldset hidden={wizardStep !== 2} disabled={wizardStep !== 2 || busy} className="step-fields">
            <div className="step-intro"><span className="eyebrow">03 / 03</span><h2>{language === 'kk' ? 'Барлығы дайын' : 'Всё готово к созданию'}</h2><p>{language === 'kk' ? 'Сабақ параметрлерін тексеріңіз.' : 'Проверьте параметры. Готовый план можно будет отредактировать.'}</p></div>
            <div className="review-grid"><Review label={language === 'kk' ? 'Пән / сынып' : 'Предмет / класс'} value={`${form.subject} · ${form.grade}`}/><Review label={language === 'kk' ? 'Тақырып' : 'Тема'} value={form.topic}/><Review label={language === 'kk' ? 'Бөлім' : 'Раздел'} value={form.section}/><Review label={language === 'kk' ? 'Үлгі' : 'Шаблон'} value={templates.find((item) => item.id === form.template_id)?.name || t.standard}/></div>
          <details className="advanced-fields" open><summary>{language === 'kk' ? 'Қосымша параметрлер' : 'Дополнительные параметры'}</summary><div className="form-grid"><Field label={language === 'kk' ? 'Педагогтің аты-жөні' : 'ФИО педагога'}><input className="input-theme" value={form.teacher_name} onChange={(event) => updateForm('teacher_name', event.target.value)} placeholder={language === 'kk' ? 'Тегі Аты Әкесінің аты' : 'Фамилия Имя Отчество'} /></Field><Field label={language === 'kk' ? 'Сабақ күні' : 'Дата урока'}><input className="input-theme" type="date" value={form.lesson_date} onChange={(event) => updateForm('lesson_date', event.target.value)} /></Field><Field label={language === 'kk' ? 'Сабақ ұзақтығы' : 'Длительность урока'}><select className="input-theme" value={form.lesson_duration} onChange={(event) => updateForm('lesson_duration', Number(event.target.value))}>{[40,45,50,60,80].map((minutes) => <option key={minutes} value={minutes}>{minutes} {language === 'kk' ? 'минут' : 'минут'}</option>)}</select></Field><Field label={language === 'kk' ? 'Тіл' : 'Язык'}><select className="input-theme" value={language} onChange={(event) => { const selected = event.target.value as Language; changeLanguage(selected); updateForm('language', selected) }}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></Field><Field label={language === 'kk' ? 'Қосымша талаптар' : 'Дополнительные пожелания'} className="full"><textarea className="input-theme" maxLength={3000} rows={3} value={form.additional_requirements} onChange={(event) => updateForm('additional_requirements', event.target.value)} placeholder={language === 'kk' ? 'Сабаққа арналған ерекше талаптар' : 'Особые условия или акценты для этого урока'} /></Field></div></details>
          </fieldset>
          <div className="wizard-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => wizardStep ? setWizardStep((step) => step - 1) : startWizard()}>{wizardStep ? t.back : (language === 'kk' ? 'Тазарту' : 'Сбросить')}</button><span>{t.step} {wizardStep + 1} / 3</span><button type="submit" className="button primary" disabled={busy}>{busy ? <span className="spinner"/> : wizardStep === 2 ? <IconSparkles size={18}/> : null}{wizardStep === 2 ? t.generate : t.next}{wizardStep < 2 && <IconArrowRight size={18}/>}</button></div>
        </form>
      </section>}

      {view === 'profile' && <section className="page-section">
        <div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← {language === 'kk' ? 'Басты бет' : 'Главная'}</button><div className="eyebrow">{t.profileEyebrow}</div><h1>{t.profileTitle}</h1><p>{t.profileDescription}</p></div></div>
        <form className="form-container profile-settings" onSubmit={(event) => void saveTeacherProfile(event)}>
          <div className="form-group"><label className="form-label">{t.fullName}</label><input className="input-theme" required minLength={3} maxLength={200} autoComplete="name" value={profileNameInput} onChange={(event) => setProfileNameInput(event.target.value)} /></div>
          <div className="grid-2 form-group"><div><label className="form-label">{language === 'kk' ? 'Мектеп' : 'Школа'}</label><input className="input-theme" value={teacherExtras.school || ''} onChange={(event) => setTeacherExtras((value) => ({ ...value, school: event.target.value }))} /></div><div><label className="form-label">{language === 'kk' ? 'Санат' : 'Категория'}</label><input className="input-theme" value={teacherExtras.category || ''} onChange={(event) => setTeacherExtras((value) => ({ ...value, category: event.target.value }))} /></div></div>
          <div className="form-group"><label className="form-label">{language === 'kk' ? 'Еңбек өтілі (жыл)' : 'Стаж (лет)'}</label><input className="input-theme" type="number" min="0" max="60" value={teacherExtras.experience || ''} onChange={(event) => setTeacherExtras((value) => ({ ...value, experience: event.target.value }))} /></div>
          <div className="form-group"><label className="form-label">{t.classes}</label><div className="onboarding-list">{profileClassesInput.map((value, index) => <div className="onboarding-list-row" key={`profile-class-${index}`}><input className="input-theme" required={index === 0} maxLength={80} value={value} onChange={(event) => setProfileClassesInput((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={t.classPlaceholder} />{profileClassesInput.length > 1 && <button type="button" className="onboarding-remove" onClick={() => setProfileClassesInput((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={t.removeClass}>×</button>}</div>)}</div><button type="button" className="onboarding-add" onClick={() => setProfileClassesInput((items) => [...items, ''])}>＋ {t.addClass}</button></div>
          <div className="form-group"><label className="form-label">{t.subjects}</label><div className="onboarding-list">{profileSubjectsInput.map((value, index) => <div className="onboarding-list-row" key={`profile-subject-${index}`}><input className="input-theme" required={index === 0} maxLength={80} value={value} onChange={(event) => setProfileSubjectsInput((items) => items.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={t.subjectPlaceholder} />{profileSubjectsInput.length > 1 && <button type="button" className="onboarding-remove" onClick={() => setProfileSubjectsInput((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={t.removeSubject}>×</button>}</div>)}</div><button type="button" className="onboarding-add" onClick={() => setProfileSubjectsInput((items) => [...items, ''])}>＋ {t.addSubject}</button></div>
          {error && <div className="inline-error" role="alert">{error}</div>}<button className="submit-btn" type="submit" disabled={busy}>{busy ? (language === 'kk' ? 'Сақталуда…' : 'Сохраняем…') : t.saveProfile}</button>
        </form>
        <div className="usage-card profile-usage"><div><span className="usage-icon">✦</span><div><strong>{usage?.subscription_active ? `${t.activeUntil} ${due}` : t.remaining}</strong><small>{usage?.subscription_active ? (usage.subscription_type === 'yearly' ? t.yearlyTariff : t.monthlyTariff) : `${usage?.free_generations ?? 0} ${t.freeOf} ${usage?.free_generations_total ?? 3} ${t.freeAvailableLabel}`}</small></div></div><div className="usage-side"><div className="meter"><span style={{ width: usage?.subscription_active ? '100%' : `${Math.max(0, ((usage?.free_generations ?? 0) / (usage?.free_generations_total || 3)) * 100)}%` }}/></div><button className="text-button" onClick={() => setView('tariff')}>{t.subscribe} →</button></div></div>
        <h2 className="profile-menu-heading">{language === 'kk' ? 'Мәзір' : 'Меню'}</h2><div className="profile-menu">
          <button className="nav-card" onClick={() => setView('lessons')}><span className="card-icon lavender"><IconFileText size={21}/></span><span className="card-copy"><b>{t.mine}</b><small>{usage?.lessons_created ?? 0} {t.savedPlans}</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('templates')}><span className="card-icon mint"><IconLayoutGrid size={21}/></span><span className="card-copy"><b>{t.templates}</b><small>{t.templateDescription}</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('tariff')}><span className="card-icon peach">◇</span><span className="card-copy"><b>{t.tariff}</b><small>{t.tariffDescription}</small></span><span className="card-arrow">↗</span></button>
          <button className="nav-card" onClick={() => setView('help')}><span className="card-icon gray">?</span><span className="card-copy"><b>{t.help}</b><small>{t.helpDescription}</small></span><span className="card-arrow">↗</span></button>
          {!isUserFrontend && user.is_admin && <button className="nav-card" onClick={() => { setView('admin'); void refreshAdmin() }}><span className="card-icon gray">⚙</span><span className="card-copy"><b>{t.adminTitle}</b><small>{t.adminDescription}</small></span><span className="card-arrow">↗</span></button>}
        </div>
      </section>}

      {view === 'preview' && active && content && <section className="panel preview-panel"><div className="panel-top"><button className="back-link" onClick={() => setView('lessons')}>← {t.mine}</button><span className="saved-pill">{isDirty ? 'Есть несохранённые изменения' : 'Сохранено'}</span></div><div className="preview-head"><div><div className="eyebrow">{t.preview}</div><h1>{content.lesson_topic}</h1><p>{content.subject} · {content.class_name} класс · {content.date}</p></div><div className="preview-actions"><button className="button secondary" onClick={regenerate} disabled={busy}>{busy ? <span className="spinner"/> : '↻'} {t.regenerate}{usage?.subscription_active ? '' : ' · −1'}</button><button className="button primary" disabled={busy} onClick={() => void download(active)}>DOCX <span>↓</span></button><button className="button secondary" disabled={busy} onClick={() => void downloadPdf(active)}>PDF <span>↓</span></button></div></div><KspEditor content={content} onChange={(updated) => { setContent(updated); setIsDirty(true) }} /><div className="edit-footer"><span>Изменения сохраняются в ваших КСП.</span><button className="button primary" onClick={() => void saveLesson()} disabled={busy}>{busy ? 'Сохраняем…' : t.save}</button></div>{error && <div className="inline-error">{error}</div>}</section>}

      {view === 'lessons' && <section className="page-section">
        <div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ВАША БИБЛИОТЕКА</div><h1>{t.mine}</h1><p>Ваши планы сохраняются в облачном архиве.</p></div><button className="button primary" onClick={() => startWizard()}>{t.create}<span>＋</span></button></div>
        <label className="archive-search"><IconSearch size={20}/><input type="search" value={archiveQuery} onChange={(e) => setArchiveQuery(e.target.value)} placeholder="Поиск по теме, классу, предмету, цели или дате" /></label>
        {visibleLessons.length ? <div className="lesson-list">{visibleLessons.map((lesson) => <article className="lesson-card" key={lesson.id}>
          <div className="lesson-symbol"><IconFileText size={23}/></div><div className="lesson-details"><span className="eyebrow">{lesson.subject} · {lesson.grade} КЛАСС</span><h3>{lesson.topic}</h3><p><span className="document-status"><IconCheck size={12}/> Готов</span> {lesson.lesson_date} <i/> Сохранён {new Date(lesson.created_at).toLocaleDateString()}</p></div>
          <div className="lesson-buttons">
            <button onClick={() => void openLesson(lesson)}>Открыть / изменить</button><button onClick={() => chooseDownload(lesson)}>Скачать Word</button>
            <button onClick={() => startWizard(false, lesson)}>Новый на основе</button>
            <button onClick={async () => { try { const duplicate = await api.copyLesson(lesson.id); await refresh(); await openLesson(duplicate); setToast('Копия создана и готова к редактированию') } catch (e) { setError(errorMessage(e)) } }}>Создать копию</button>
            <button className="danger-text" onClick={async () => { if (window.confirm('Удалить этот КСП?')) { try { await api.deleteLesson(lesson.id); await refresh() } catch (e) { setError(errorMessage(e)) } } }}>Удалить</button>
          </div>
        </article>)}</div> : <div className="empty-state"><span className="empty-icon"><IconFileText size={26}/></span><h2>{archiveQuery ? 'Ничего не найдено' : t.empty}</h2><p>{archiveQuery ? 'Попробуйте другой запрос.' : 'Создайте первый план, и он сохранится в вашем архиве.'}</p>{!archiveQuery && <button className="button primary" onClick={() => startWizard()}>{t.start}<span>→</span></button>}</div>}
      </section>}

      {view === 'templates' && <section className="page-section"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← {language === 'kk' ? 'Басты бет' : 'Обзор'}</button><div className="eyebrow">{language === 'kk' ? 'ҚҰЖАТ ФОРМАТТАРЫ' : 'ФОРМАТЫ ДОКУМЕНТОВ'}</div><h1>{t.templates}</h1><p>{language === 'kk' ? 'Мектеп үлгісін сақтап, сабаққа пайдаланыңыз.' : 'Ваши школьные бланки — всегда под рукой.'}</p></div><span className="count-badge">{templates.length + 1}</span></div>
        <div className="template-list"><article className="template-card"><div className="template-art"><DocumentPreview/></div><div className="template-card-body"><span className="eyebrow">{language === 'kk' ? 'БАЗАЛЫҚ' : 'ВСТРОЕННЫЙ'}</span><h3>{t.standard}</h3><p>{language === 'kk' ? 'Сабақ кезеңдері, мақсаттары және бағалау' : 'Цели, этапы, дифференциация, языковые цели и безопасность'}</p><button className="button secondary full-width" onClick={() => { startWizard(); updateForm('template_id', null) }}>{language === 'kk' ? 'Үлгіні қолдану' : 'Использовать шаблон'}<IconArrowRight size={16}/></button><a className="button secondary full-width" href="/Объединённый_шаблон_КСП.docx" download>{language === 'kk' ? 'Бланкті жүктеу' : 'Скачать бланк DOCX'}</a></div></article>
        {templates.map((item) => <article className="template-card" key={item.id}><div className="template-art"><DocumentPreview custom/><span className="file-type">{item.file_type.toUpperCase()}</span></div><div className="template-card-body"><span className="eyebrow">{new Date(item.created_at).toLocaleDateString()}</span><h3>{item.name}</h3><p>{item.template_structure?.analysis_status === 'extracted' ? (language === 'kk' ? 'Пішім талданды' : 'Структура распознана') : (language === 'kk' ? 'Жүктелді' : 'Файл загружен')}</p><button className="button secondary full-width" onClick={() => { startWizard(); updateForm('template_id', item.id) }}>{language === 'kk' ? 'Қолдану' : 'Использовать'}<IconArrowRight size={16}/></button><button className="danger-text" disabled={busy} onClick={async () => { if (confirm(language === 'kk' ? 'Үлгіні жою керек пе?' : 'Удалить шаблон?')) { try { await api.deleteTemplate(item.id); setTemplates((list) => list.filter((x) => x.id !== item.id)) } catch (e) { setError(errorMessage(e)) } } }}>{language === 'kk' ? 'Жою' : 'Удалить шаблон'}</button></div></article>)}</div>
        <div className="upload-panel"><span className="upload-icon"><IconUpload size={25}/></span><div><h2>{t.upload}</h2><p>DOCX, PDF, PNG, JPG · {language === 'kk' ? '10 МБ дейін' : 'до 10 МБ'}</p></div><div className="upload-fields"><input aria-label={language === 'kk' ? 'Үлгі атауы' : 'Название шаблона'} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={language === 'kk' ? 'Үлгі атауы' : 'Название шаблона'}/><label className={`button primary upload-button ${busy ? 'disabled' : ''}`}>{busy ? (language === 'kk' ? 'Жүктелуде…' : 'Загружаем…') : (language === 'kk' ? 'Файл таңдау' : 'Выбрать файл')}<input type="file" aria-label={t.upload} accept=".docx,.pdf,.png,.jpg,.jpeg" onChange={handleUpload} disabled={busy}/></label></div></div>
        <div className="notice"><IconFileText size={21}/><div><b>{language === 'kk' ? 'Үлгі қалай қолданылады' : 'Как используется шаблон'}</b><p>{language === 'kk' ? 'Үлгі жоспар жасау кезінде ескеріледі. Экспорт стандартты бланкпен жасалады. Суреттердегі мәтінді тану әлі қолжетімсіз.' : 'Содержимое шаблона учитывается при создании плана. Экспорт оформляется по стандартному бланку. Распознавание текста на изображениях пока недоступно.'}</p></div></div>
      </section>}

      {view === 'admin' && !isUserFrontend && user.is_admin && <section className="page-section admin-page"><div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ЗАЩИЩЁННЫЙ РАЗДЕЛ</div><h1>Администрирование</h1><p>Показатели работы, пользователи, подписки и платежи.</p></div><button className="button secondary" onClick={() => void refreshAdmin()} disabled={busy}>{busy ? 'Обновляем…' : 'Обновить ↻'}</button></div>{adminStats ? <div className="admin-stats">{[["Пользователи", adminStats.users_total, `Новые сегодня: ${adminStats.users_new_today}`], ["Активны за 30 дней", adminStats.users_active_30d, `Заблокировано: ${adminStats.users_blocked}`], ["Генерации", adminStats.generations_total, `Сегодня: ${adminStats.generations_today} · месяц: ${adminStats.generations_month}`], ["Бесплатные / платные", `${adminStats.generations_free} / ${adminStats.generations_paid}`, `КСП всего: ${adminStats.lessons_total}`], ["Подписки", adminStats.active_subscriptions, `Месячные: ${adminStats.monthly_subscriptions} · годовые: ${adminStats.yearly_subscriptions}`], ["Платежи", `${adminStats.payments_success} успешных`, `Ожидают: ${adminStats.payments_pending} · ошибка: ${adminStats.payments_failed}`], ["Сумма успешных", `${adminStats.payments_amount} ₸`, "KZT"], ["AI-запросы", adminStats.ai_requests, `Ошибки: ${adminStats.ai_errors} · токены: ${(adminStats.ai_prompt_tokens + adminStats.ai_completion_tokens).toLocaleString()}`], ["Стоимость AI", `${adminStats.ai_cost.toFixed(4)}`, "OpenRouter"]].map(([title, value, detail]) => <article className="admin-stat" key={String(title)}><small>{title}</small><b>{value}</b><span>{detail}</span></article>)}</div> : <div className="empty-state"><p>Нажмите «Обновить», чтобы загрузить административные данные.</p><button className="button primary" onClick={() => void refreshAdmin()}>Загрузить сводку</button></div>}
        <div className="admin-section-title"><div><div className="eyebrow">АККАУНТЫ</div><h2>Пользователи</h2></div><span className="muted">{adminUsers.length} записей</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Пользователь / Telegram ID</th><th>Бесплатные</th><th>Подписка</th><th>Управление</th></tr></thead><tbody>{!adminUsers.length && <tr><td colSpan={4} className="table-empty">Пользователей пока нет</td></tr>}{adminUsers.map((person) => <tr key={person.id}><td data-label="Пользователь"><b>{[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Пользователь'}</b><small>{person.telegram_user_id}{person.is_admin ? ' · администратор' : ''}</small></td><td data-label="Бесплатные генерации">{person.free_generations}</td><td data-label="Подписка">{person.subscription_status === 'active' ? `${person.subscription_type || ''} · ${person.subscription_end ? new Date(person.subscription_end).toLocaleDateString() : 'активна'}` : 'Бесплатный'}</td><td data-label="Управление"><div className="admin-actions"><button onClick={async () => { try { setAdminDetail(await api.adminUser(person.id)) } catch (e) { setError(errorMessage(e)) } }}>Профиль</button><button onClick={() => void adminAction(() => api.adminCredits(person.id))}>+3 генерации</button><button onClick={() => void adminAction(() => api.adminSubscription(person.id, 'monthly'))}>Месяц</button><button onClick={() => void adminAction(() => api.adminSubscription(person.id, 'yearly'))}>Год</button><button className="danger-text" disabled={person.id === user.id && !person.is_blocked} onClick={() => void adminAction(() => api.adminBlock(person.id, !person.is_blocked))}>{person.is_blocked ? 'Разблокировать' : 'Блокировать'}</button></div></td></tr>)}</tbody></table></div>
        <div className="admin-section-title"><div><div className="eyebrow">ОПЛАТА</div><h2>Последние платежи</h2></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Дата</th><th>Тариф</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{!adminPayments.length && <tr><td colSpan={4} className="table-empty">Платежей пока нет</td></tr>}{adminPayments.slice(0, 20).map((payment) => <tr key={payment.id}><td data-label="Дата">{new Date(payment.created_at).toLocaleString()}</td><td data-label="Тариф">{payment.tariff === 'yearly' ? 'Годовой' : 'Месячный'}</td><td data-label="Сумма">{payment.amount} {payment.currency}</td><td data-label="Статус"><span className={`status-pill ${payment.status}`}>{payment.status}</span></td></tr>)}</tbody></table></div>
      </section>}

      {view === 'tariff' && <section className="page-section tariff-page">
        <div className="page-title"><div><button className="back-link" onClick={() => setView('home')}>← Главная</button><div className="eyebrow">ПОДДЕРЖКА ВАШЕЙ РАБОТЫ</div><h1>{t.tariff}</h1><p>Выберите подходящий объём доступа к генератору.</p></div></div>
        {usage?.subscription_active && <div className="active-banner"><span>✓</span><div><b>Подписка активна</b><small>Доступ до {due}</small></div></div>}
        <div className="tariff-grid">
          <article className="tariff-card"><span className="tariff-label">СТАРТ</span><h2>Бесплатный</h2><div className="price">0 ₸ <small>/ всегда</small></div><p>Попробуйте создание КСП с помощью AI.</p><ul><li>3 генерации</li><li>Сохранение планов</li><li>Экспорт в DOCX</li></ul><button className="button secondary full-width" onClick={() => startWizard()}>Продолжить бесплатно</button></article>
          <article className="tariff-card"><span className="tariff-label">МЕСЯЦ</span><h2>Месячный</h2><div className="price">750 ₸ <small>/ месяц</small></div><p>Продолжайте создавать планы весь месяц.</p><ul><li>Генерации по подписке</li><li>Все функции КСП</li><li>Подписка на 30 дней</li></ul>{subscriptionInfo?.payments_available ? <button className="button primary full-width" onClick={() => void createPayment('monthly')} disabled={busy}>Тестовый платёж на месяц <span>→</span></button> : <button className="button secondary full-width" disabled>Оплата пока недоступна</button>}</article>
          <article className="tariff-card featured"><span className="recommended">ВЫГОДНЕЕ НА 39%</span><span className="tariff-label">ГОД</span><h2>Годовой</h2><div className="price">5 500 ₸ <small>/ год</small></div><p>Годовой доступ по более выгодной цене.</p><ul><li>Генерации по подписке</li><li>Все функции КСП</li><li>Подписка на 365 дней</li></ul>{subscriptionInfo?.payments_available ? <button className="button secondary full-width" onClick={() => void createPayment('yearly')} disabled={busy}>Тестовый платёж на год <span>→</span></button> : <button className="button secondary full-width" disabled>Оплата пока недоступна</button>}</article>
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
    {resumeDraft && view === 'home' && <Modal title="Продолжить создание КСП?" onClose={() => setResumeDraft(false)}><div className="resume-modal"><button className="modal-close" aria-label={t.close} onClick={() => { setResumeDraft(false); sessionStorage.removeItem('ksp_draft') }}>×</button><span className="card-icon blue">✎</span><h2>Продолжить создание КСП?</h2><p>Сохранённый черновик готов к продолжению.</p><div><button className="button secondary" onClick={() => { setResumeDraft(false); sessionStorage.removeItem('ksp_draft') }}>Начать заново</button><button className="button primary" onClick={() => startWizard(true)}>Продолжить <span>→</span></button></div></div></Modal>}
    {adminDetail && <Modal title="Профиль пользователя" onClose={() => setAdminDetail(null)}><div className="resume-modal admin-detail-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label={t.close} onClick={() => setAdminDetail(null)}>×</button><span className="eyebrow">ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ</span><h2>{[adminDetail.user.first_name, adminDetail.user.last_name].filter(Boolean).join(' ') || 'Пользователь'}</h2><p>Telegram ID: {adminDetail.user.telegram_user_id}<br/>Бесплатных генераций: {adminDetail.user.free_generations}<br/>Подписка: {adminDetail.user.subscription_status} {adminDetail.user.subscription_type || ''}</p><div className="admin-detail-list"><b>Платежи</b>{adminDetail.payments.length ? adminDetail.payments.map((payment) => <span key={payment.id}>{payment.tariff} · {payment.amount} {payment.currency} · {payment.status}</span>) : <small>Платежей пока нет</small>}<b>Подписки</b>{adminDetail.subscriptions.length ? adminDetail.subscriptions.map((item) => <span key={item.id}>{item.type} · {item.status} · {item.end_date ? new Date(item.end_date).toLocaleDateString() : '—'}</span>) : <small>Подписок пока нет</small>}</div><button className="button secondary full-width" onClick={() => setAdminDetail(null)}>Закрыть</button></div></Modal>}
    {toast && <div className="toast" role="status"><IconCheck size={18}/>{toast}</div>}
    <Navigation view={view} language={language} admin={!isUserFrontend && user.is_admin} create={() => startWizard()} navigate={(destination) => { setView(destination); if (destination === 'admin') void refreshAdmin() }}/>
    {generating && <Modal title={t.generating}><section className="generation-card" role="status" aria-live="polite" aria-busy="true"><span className="generation-symbol"><IconSparkles size={30}/></span><span className="eyebrow">{language === 'kk' ? 'ЖОСПАР ДАЙЫНДАЛУДА' : 'СОБИРАЕМ ВАШ ПЛАН'}</span><h2>{t.generating}</h2><p>{form.topic}</p><div className="indeterminate-progress"><span/></div><small>{language === 'kk' ? 'Әдетте 10–15 секунд қажет. Қолданбаны жаппаңыз.' : 'Обычно это занимает 10–15 секунд. Оставьте приложение открытым.'}</small></section></Modal>}

  </div>
}

function SplashScreen({ message, error, language, onRetry }: { message: string; error?: string; language: Language; onRetry?: () => void }) {
  return <main className={`auth-shell splash-shell${error ? ' has-error' : ''}`} aria-live="polite" aria-busy={!error}>
    <div className="splash-brand" aria-hidden="true"><span className="brand-mark"><IconLayoutGrid size={22}/></span>{!error && <span className="splash-loader" />}</div>
    <span className="eyebrow">{language === 'kk' ? 'САБАҚ ЖОСПАРЫ · ҚАЗАҚСТАН' : 'ПЛАН УРОКА · КАЗАХСТАН'}</span>
    <h1>TeacherBot</h1>
    <p>{error || message}</p>
    {error && onRetry && <button className="button primary" onClick={onRetry}>{language === 'kk' ? 'Қайталап көру' : 'Попробовать снова'}</button>}
  </main>
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) { return <label className={`field ${className}`}><span>{label}</span>{children}</label> }
function Review({ label, value }: { label: string; value: string }) { return <div className="review-item"><small>{label}</small><span>{value || '—'}</span></div> }
function ObjectiveEditor({ number, title, helper, values, onChange }: { number: string; title: string; helper: string; values: string[]; onChange: (v: string[]) => void }) { return <div className="objective-box"><div className="objective-heading"><span className="objective-number">{number}</span><div><b>{title}</b><small>{helper}</small></div></div>{values.map((value, index) => <div className="objective-input" key={index}><span>{index + 1}</span><textarea rows={2} value={value} onChange={(e) => onChange(values.map((x, i) => i === index ? e.target.value : x))} placeholder="Введите формулировку цели"/><button type="button" aria-label="Удалить цель" onClick={() => onChange(values.length > 1 ? values.filter((_, i) => i !== index) : [''])}>×</button></div>)}<button type="button" className="add-objective" onClick={() => onChange([...values, ''])}>＋ Добавить ещё цель</button></div> }

function KspEditor({ content, onChange }: { content: Lesson['content_json']; onChange: (content: Lesson['content_json']) => void }) {
  function field<K extends keyof Lesson['content_json']>(key: K, value: Lesson['content_json'][K]) { onChange({ ...content, [key]: value }) }
  const stages = (index: number, key: keyof Stage, value: string) => field('stages', content.stages.map((stage, i) => i === index ? { ...stage, [key]: value } : stage))
  return <div className="document-wrap"><div className="document-title">{content.title}</div><div className="document-subtitle"><strong>{content.language === 'kk' ? 'Сабақ тақырыбы:' : 'Тема урока:'}</strong><input aria-label={content.language === 'kk' ? 'Сабақ тақырыбы' : 'Тема урока'} value={content.lesson_topic} onChange={(e) => field('lesson_topic', e.target.value)} /></div>
    <div className="document-bottom"><label>{content.language === 'kk' ? 'Мектеп / ұйым' : 'Школа / организация'}<input value={content.school ?? ''} maxLength={300} onChange={(e) => field('school', e.target.value)}/></label><label>{content.language === 'kk' ? 'Пән' : 'Предмет'}<input value={content.subject} onChange={(e) => field('subject', e.target.value)}/></label></div>
    <div className="ksp-meta">
      <div className="meta-section"><strong>{content.language === 'kk' ? 'Бөлім:' : 'Раздел:'}</strong><input aria-label={content.language === 'kk' ? 'Бөлім' : 'Раздел'} value={content.section} onChange={(e) => field('section', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Педагогтің аты-жөні:' : 'ФИО педагога:'}</div><div className="meta-value wide"><input value={content.teacher_name} onChange={(e) => field('teacher_name', e.target.value)} /></div>
      <div className="meta-label">{content.language === 'kk' ? 'Күні:' : 'Дата:'}</div><div className="meta-value wide"><input value={content.date} onChange={(e) => field('date', e.target.value)} /></div>
      <div className="meta-value">{content.language === 'kk' ? 'Сынып:' : 'Класс:'} <input aria-label={content.language === 'kk' ? 'Сынып' : 'Класс'} value={content.class_name} onChange={(e) => field('class_name', e.target.value)} /></div><div className="meta-value">{content.language === 'kk' ? 'Қатысқандар саны:' : 'Количество присутствующих:'} <input type="number" value={content.present_count} onChange={(e) => field('present_count', Number(e.target.value))} /></div><div className="meta-value">{content.language === 'kk' ? 'Қатыспағандар саны:' : 'Количество отсутствующих:'} <input type="number" value={content.absent_count} onChange={(e) => field('absent_count', Number(e.target.value))} /></div>
      <div className="meta-label tall">{content.language === 'kk' ? 'Оқу бағдарламасына сәйкес оқу мақсаттары' : 'Цели обучения в соответствии с учебной программой'}</div><div className="meta-value wide tall"><ListEditor values={content.learning_objectives} onChange={(v) => field('learning_objectives', v)}/></div>
      <div className="meta-label">{content.language === 'kk' ? 'Сабақ мақсаттары' : 'Цели урока'}</div><div className="meta-value wide"><ListEditor values={content.lesson_objectives} onChange={(v) => field('lesson_objectives', v)}/></div>
      <div className="meta-journey">{content.language === 'kk' ? 'Сабақ барысы' : 'Ход урока'}</div>
    </div>
    <div className="table-scroll"><table className="ksp-table"><thead><tr><th>{content.language === 'kk' ? 'Сабақ кезеңі/уақыты' : 'Этап урока/время'}</th><th>{content.language === 'kk' ? 'Педагогтің әрекеті' : 'Действия педагога'}</th><th>{content.language === 'kk' ? 'Оқушының әрекеті' : 'Действия ученика'}</th><th>{content.language === 'kk' ? 'Ресурстар' : 'Ресурсы'}</th><th>{content.language === 'kk' ? 'Бағалау' : 'Оценивание'}</th></tr></thead><tbody>{content.stages.map((stage, index) => <tr key={index}><td><input aria-label={content.language === 'kk' ? 'Сабақ кезеңі' : 'Этап урока'} value={stage.stage_name} onChange={(e) => stages(index, 'stage_name', e.target.value)}/><input className="time-input" aria-label={content.language === 'kk' ? 'Уақыт' : 'Время'} value={stage.time} onChange={(e) => stages(index, 'time', e.target.value)}/></td><td data-label={content.language === 'kk' ? 'Педагогтің әрекеті' : 'Действия педагога'}><textarea aria-label="Действия педагога" value={stage.teacher_actions} onChange={(e) => stages(index, 'teacher_actions', e.target.value)}/></td><td data-label={content.language === 'kk' ? 'Оқушының әрекеті' : 'Действия ученика'}><textarea aria-label="Действия ученика" value={stage.student_actions} onChange={(e) => stages(index, 'student_actions', e.target.value)}/></td><td data-label={content.language === 'kk' ? 'Ресурстар' : 'Ресурсы'}><textarea aria-label="Ресурсы" value={stage.resources} onChange={(e) => stages(index, 'resources', e.target.value)}/></td><td data-label={content.language === 'kk' ? 'Бағалау' : 'Оценивание'}><textarea aria-label="Оценивание" value={stage.assessment} onChange={(e) => stages(index, 'assessment', e.target.value)}/></td></tr>)}</tbody></table></div>
    <div className="document-bottom">{([
      ['language_objectives', 'Языковые цели', 'Тілдік мақсаттар'],
      ['differentiation_plan', 'Дифференциация', 'Саралау'],
      ['assessment_plan', 'Оценивание', 'Бағалау'],
      ['cross_curricular_links', 'Межпредметные связи', 'Пәнаралық байланыстар'],
      ['health_and_safety', 'Здоровье и безопасность', 'Денсаулық және қауіпсіздік'],
    ] as const).map(([key, ru, kk]) => <label key={key}>{content.language === 'kk' ? kk : ru}<textarea value={content[key] ?? ''} maxLength={2000} rows={3} onChange={(e) => field(key, e.target.value)}/></label>)}</div>
    <div className="document-bottom"><label>{content.language === 'kk' ? 'Үй тапсырмасы' : 'Домашнее задание'}<textarea value={content.homework} onChange={(e) => field('homework', e.target.value)} placeholder={content.language === 'kk' ? 'Тапсырма жоқ' : 'Не задано'} rows={2}/></label><label>{content.language === 'kk' ? 'Рефлексия' : 'Рефлексия'}<textarea value={content.reflection} onChange={(e) => field('reflection', e.target.value)} rows={2}/></label></div>
  </div>
}
function ListEditor({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) { return <div className="list-editor">{values.map((value, index) => <div key={index}><textarea rows={2} value={value} onChange={(e) => onChange(values.map((item, i) => i === index ? e.target.value : item))}/><button aria-label="Удалить" onClick={() => onChange(values.length > 1 ? values.filter((_, i) => i !== index) : [''])}>×</button></div>)}<button className="mini-add" onClick={() => onChange([...values, ''])}>＋ добавить</button></div>}

import { IconArrowRight, IconBolt, IconBook2, IconCheck, IconCreditCard, IconFileText, IconHelpCircle, IconHome, IconLayoutGrid, IconPlus, IconSettings, IconSparkles, IconUserCircle, IconMessageCircle, IconSend, IconDownload, IconCrown, IconClock, IconPencil, IconCalendar } from '@tabler/icons-react'
import type { Lesson, Usage } from '../api'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export type WorkspaceView = 'home' | 'wizard' | 'lessons' | 'templates' | 'tariff' | 'help' | 'preview' | 'admin' | 'profile'
type Language = 'ru' | 'kk'

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow }
  }, [])
  return <dialog ref={ref} className="modal-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose?.() }} onClick={(event) => { if (event.target === event.currentTarget) onClose?.() }}>{children}</dialog>
}

export function Navigation({ view, language, admin, navigate, create }: { view: WorkspaceView; language: Language; admin: boolean; navigate: (view: WorkspaceView) => void; create: () => void }) {
  const kk = language === 'kk'
  const items = [
    { view: 'home' as const, title: kk ? 'Көмекші' : 'Помощник', icon: IconMessageCircle },
    { view: 'lessons' as const, title: kk ? 'Құжаттар' : 'Документы', icon: IconFileText },
    { view: 'templates' as const, title: kk ? 'Үлгілер' : 'Шаблоны', icon: IconLayoutGrid },
    { view: 'tariff' as const, title: kk ? 'Тарифтер' : 'Тарифы', icon: IconCreditCard },
    { view: 'profile' as const, title: kk ? 'Профиль' : 'Профиль', icon: IconUserCircle, IconMessageCircle, IconSend, IconDownload, IconCrown, IconClock, IconPencil, IconCalendar },
  ]
  return <nav className="workspace-nav" aria-label={kk ? 'Негізгі мәзір' : 'Основная навигация'}>
    <span className="nav-caption">{kk ? 'ЖҰМЫС ОРНЫ' : 'РАБОЧЕЕ ПРОСТРАНСТВО'}</span>
    <button className="button primary nav-new" onClick={create}><IconPlus size={18}/>{kk ? 'ҚМЖ құру' : 'Создать КСП'}</button>
    {items.map(({ view: destination, title, icon: Icon }) => <button key={destination} className={`nav-item ${view === destination || (destination === 'lessons' && view === 'preview') ? 'active' : ''}`} aria-current={view === destination ? 'page' : undefined} onClick={() => navigate(destination)}><Icon size={21} stroke={1.7}/><span>{title}</span></button>)}
    <div className="nav-premium"><IconCrown size={23}/><b>{kk ? 'Көбірек мүмкіндіктер' : 'Больше возможностей'}</b><p>{kk ? 'Сабаққа ыңғайлы дайындық' : 'Всё для спокойной подготовки к уроку'}</p><button className="button primary full-width" onClick={() => navigate('tariff')}>{kk ? 'Тарифті таңдау' : 'Выбрать тариф'}<IconArrowRight size={16}/></button></div><div className="nav-bottom"><button className={`nav-item ${view === 'help' ? 'active' : ''}`} onClick={() => navigate('help')}><IconHelpCircle size={21}/><span>{kk ? 'Көмек' : 'Помощь'}</span></button>{admin && <button className={`nav-item ${view === 'admin' ? 'active' : ''}`} onClick={() => navigate('admin')}><IconSettings size={21}/><span>{kk ? 'Әкімші' : 'Администратор'}</span></button>}<small>{kk ? 'Сабаққа көбірек уақыт.' : 'Больше времени для урока.'}</small></div>
  </nav>
}

export function DocumentPreview({ custom = false }: { custom?: boolean }) {
  return <div className={`document-mini ${custom ? 'custom' : ''}`} aria-hidden="true"><div className="mini-heading"/><div className="mini-line"/><div className="mini-line short"/><div className="mini-table">{Array.from({ length: 12 }, (_, index) => <i key={index}/>)}</div><div className="mini-line"/><div className="mini-line short"/></div>
}

export function Dashboard({ name, language, usage, lessons, due, create, navigate, openLesson, chat, downloadLesson }: { name: string; language: Language; usage: Usage | null; lessons: Lesson[]; due: string; create: (substitute?: boolean) => void; navigate: (view: WorkspaceView) => void; openLesson: (lesson: Lesson) => void; chat: ReactNode; downloadLesson: (lesson: Lesson) => void }) {
  const kk = language === 'kk'
  const last = lessons[0]
  const remaining = usage?.free_generations ?? 0
  const actions = [
    { icon: IconCalendar, title: kk ? 'Сабақ жоспары' : 'План урока', color: 'purple', action: () => create() },
    { icon: IconBolt, title: kk ? 'Орнындағы мұғалім' : 'Урок на замене', color: 'mint', action: () => create(true) },
    { icon: IconLayoutGrid, title: kk ? 'Үлгілер' : 'Мои шаблоны', color: 'blue', action: () => navigate('templates') },
    { icon: IconFileText, title: kk ? 'Құжаттар' : 'Документы', color: 'peach', action: () => navigate('lessons') },
    { icon: IconUserCircle, title: kk ? 'Профиль' : 'Мой профиль', color: 'pink', action: () => navigate('profile') },
    { icon: IconBook2, title: kk ? 'Көмек' : 'Как это работает', color: 'lavender', action: () => navigate('help') },
  ]
  return <section className="teacher-workspace">
    <div className="teacher-main">
      <article className="teacher-welcome">
        <img className="teacher-mascot" src="/teacherbot.webp" width="180" height="270" alt="TeacherBot" fetchPriority="high"/>
        <div className="teacher-welcome-copy"><span className="eyebrow">{kk ? 'МҰҒАЛІМНІҢ AI-КӨМЕКШІСІ' : 'ВАШ AI-ПОМОЩНИК'}</span><h1>{kk ? 'Сәлем' : 'Здравствуйте'}, {name}! <span className="welcome-wave">👋</span></h1><p>{kk ? 'Мен TeacherBot — сабаққа дайындалудағы көмекшіңізбін. Бүгін қандай сабақ дайындаймыз?' : 'Я TeacherBot — ваш помощник в подготовке к занятиям. Какой урок подготовим сегодня?'}</p><div className="welcome-actions"><button onClick={() => create()}><IconCalendar size={19}/>{kk ? 'ҚМЖ құру' : 'Создать новый КСП'}</button><button onClick={() => navigate('templates')}><IconLayoutGrid size={19}/>{kk ? 'Үлгіні таңдау' : 'Выбрать шаблон'}</button><button onClick={() => navigate('lessons')}><IconFileText size={19}/>{kk ? 'Менің құжаттарым' : 'Мои документы'}</button></div></div>
      </article>
      {chat}
      <div className="composer-shortcuts"><button onClick={() => navigate('templates')}><IconLayoutGrid size={16}/>{kk ? 'Өз үлгім' : 'Свой шаблон'}</button><button onClick={() => create(true)}><IconBolt size={16}/>{kk ? 'Орнындағы мұғалім' : 'Урок на замене'}</button><button onClick={() => navigate('help')}><IconHelpCircle size={16}/>{kk ? 'Көмек' : 'Помощь'}</button></div>
    </div>
    <aside className="teacher-aside">
      <section className="aside-panel"><div className="aside-heading"><h2>{kk ? 'Жылдам әрекеттер' : 'Быстрые действия'}</h2><IconSparkles size={19}/></div><div className="teacher-action-grid">{actions.map(({ icon: Icon, title, color, action }) => <button key={title} className={`teacher-action ${color}`} onClick={action}><Icon size={27} stroke={1.7}/><span>{title}</span></button>)}</div></section>
      <section className="aside-panel"><div className="aside-heading"><h2>{kk ? 'Соңғы құжаттар' : 'Последние документы'}</h2><button className="text-button" onClick={() => navigate('lessons')}>{kk ? 'Барлығы' : 'Все'}<IconArrowRight size={14}/></button></div>{lessons.length ? <div className="aside-documents">{lessons.slice(0,4).map((lesson) => <button key={lesson.id} onClick={() => openLesson(lesson)}><span className="icon-box"><IconFileText size={17}/></span><span><b>{lesson.topic}</b><small>{lesson.subject} · {lesson.grade}</small></span><IconArrowRight size={14}/></button>)}</div> : <p className="aside-empty">{kk ? 'Сақталған жоспарлар осында көрсетіледі.' : 'Здесь появятся ваши сохранённые планы.'}</p>}</section>
      <section className="aside-panel teacher-balance"><div className="aside-heading"><h2>{kk ? 'Менің мүмкіндіктерім' : 'Ваши возможности'}</h2><IconBolt size={20}/></div><div className="balance-tiles"><div><IconFileText size={20}/><b>{lessons.length}</b><small>{kk ? 'құжат сақталды' : 'планов сохранено'}</small></div><div><IconCheck size={20}/><b>{usage?.subscription_active ? '✓' : remaining}</b><small>{usage?.subscription_active ? (kk ? 'жазылым белсенді' : 'подписка активна') : (kk ? 'генерация қалды' : 'генераций доступно')}</small></div></div>{usage?.subscription_active && <p>{kk ? 'Мерзімі' : 'Доступ до'} {due}</p>}<button className="text-button" onClick={() => navigate('tariff')}>{kk ? 'Тарифтерді қарау' : 'Посмотреть тарифы'}<IconArrowRight size={15}/></button></section>
      <div className="teacher-note"><IconBook2 size={25}/><p>{kk ? 'Күнделікті жұмысқа аз уақыт. Шабытқа көбірек орын.' : 'Меньше времени на рутину. Больше — на вдохновение.'}<small>— TeacherBot</small></p></div>
    </aside>
  </section>
}

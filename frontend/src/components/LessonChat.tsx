import { useRef, useState } from 'react'
import type { Lesson } from '../api'

export type ChatLessonInput = { topic: string; subject: string; grade: string; present: number; absent: number }
type Props = {
  language: 'ru' | 'kk'; subjects: string[]; classes: string[]; lessons: Lesson[];
  generate: (input: ChatLessonInput) => Promise<Lesson>;
  tasks: (lesson: Lesson) => Promise<Lesson>;
  open: (lesson: Lesson) => void; download: (lesson: Lesson) => void;
}

export function LessonChat({ language, subjects, classes, lessons, generate, tasks, open, download }: Props) {
  const kk = language === 'kk'
  const [mode, setMode] = useState<'plan' | 'tasks'>('plan')
  const [step, setStep] = useState<'topic' | 'subject' | 'grade' | 'confirm' | 'done'>('topic')
  const [draft, setDraft] = useState<ChatLessonInput>({ topic: '', subject: '', grade: '', present: 25, absent: 0 })
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState<string[]>([])
  const [result, setResult] = useState<Lesson | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const selectedLesson = lessons.find(item => item.id === selected) ?? lessons[0]
  const questions = kk
    ? ['Сабақтың тақырыбын жазыңыз.', 'Қай пән бойынша?', 'Қай сыныпқа арналған?']
    : ['Напишите тему урока.', 'По какому предмету подготовить КСП?', 'Для какого класса?']
  const index = step === 'topic' ? 0 : step === 'subject' ? 1 : 2
  function submit(value: string) {
    const clean = value.trim()
    if (!clean || lock.current) return
    const key = step === 'topic' ? 'topic' : step === 'subject' ? 'subject' : 'grade'
    setDraft(current => ({ ...current, [key]: clean }))
    setAnswers(current => [...current, clean]); setText(''); setError('')
    setStep(step === 'topic' ? 'subject' : step === 'subject' ? 'grade' : 'confirm')
  }
  async function run(action: () => Promise<Lesson>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { const lesson = await action(); if (mode === 'plan') { setResult(lesson); setStep('done') } else setSelected(lesson.id) }
    catch (e) { setError(e instanceof Error ? e.message : (kk ? 'Қате орын алды' : 'Не удалось выполнить запрос')) }
    finally { lock.current = false; setBusy(false) }
  }
  function reset() { setStep('topic'); setAnswers([]); setText(''); setResult(null); setError('') }
  const practice = selectedLesson?.content_json.practice_tasks ?? []
  return <section className="lesson-chat" aria-label={kk ? 'TeacherBot чаты' : 'Чат с TeacherBot'}>
    <div className="chat-tabs"><button className={mode === 'plan' ? 'active' : ''} disabled={busy} onClick={() => setMode('plan')}>{kk ? 'КСП чатта' : 'КСП в чате'}</button><button className={mode === 'tasks' ? 'active' : ''} disabled={busy} onClick={() => setMode('tasks')}>{kk ? 'ҚМЖ бойынша тапсырмалар' : 'Задачи по КСП'}</button></div>
    {mode === 'plan' ? <>
      <div className="chat-history" role="log" aria-live="polite">{answers.map((answer, i) => <div key={i}><p className="chat-bot-line"><b>TeacherBot</b>{questions[i]}</p><p className="chat-user-line">{answer}</p></div>)}
        {step !== 'confirm' && step !== 'done' && <p className="chat-bot-line"><b>TeacherBot</b>{questions[index]}</p>}
        {step === 'confirm' && <div className="chat-bot-line"><b>TeacherBot</b><p>{draft.subject} · {draft.grade} · {draft.topic}</p><p>{kk ? '45 минут. Қатысушылар санын тексеріңіз. Мақсаттарды AI ұсынады, оларды тексере аласыз.' : 'План на 45 минут. Проверьте посещаемость. Цели предложит ИИ — их можно проверить и исправить в готовом плане.'}</p><div className="chat-attendance"><label>{kk ? 'Қатысқандар' : 'Присутствуют'}<input type="number" min={0} max={1000} value={draft.present} disabled={busy} onChange={e => setDraft({ ...draft, present: Math.min(1000, Math.max(0, Number(e.target.value))) })}/></label><label>{kk ? 'Қатыспағандар' : 'Отсутствуют'}<input type="number" min={0} max={1000} value={draft.absent} disabled={busy} onChange={e => setDraft({ ...draft, absent: Math.min(1000, Math.max(0, Number(e.target.value))) })}/></label></div><button className="button primary" disabled={busy} onClick={() => void run(() => generate(draft))}>{kk ? 'КСП жасау' : 'Создать КСП'}</button><button className="text-button" disabled={busy} onClick={reset}>{kk ? 'Өзгерту' : 'Изменить ответы'}</button></div>}
        {step === 'done' && result && <div className="chat-bot-line"><b>TeacherBot</b><p>{kk ? 'Дайын! Жоспар құжаттарда сақталды.' : 'Готово! План сохранён в ваших документах.'}</p><strong>{result.topic}</strong><div className="chat-document-actions"><button className="button primary" onClick={() => open(result)}>{kk ? 'Ашу' : 'Открыть КСП'}</button><button className="button secondary" onClick={() => download(result)}>DOCX</button><button className="button secondary" onClick={() => { setSelected(result.id); setMode('tasks') }}>{kk ? 'Тапсырмалар' : 'Задачи по этому КСП'}</button></div><button className="text-button" onClick={reset}>{kk ? 'Жаңа сабақ' : 'Новый урок в чате'}</button></div>}
      </div>
      {(step === 'topic' || step === 'subject' || step === 'grade') && <form className="topic-composer" onSubmit={e => { e.preventDefault(); submit(text) }}><div className="suggestion-topics">{(step === 'subject' ? subjects : step === 'grade' ? classes : []).map(value => <button type="button" key={value} onClick={() => submit(value)}>{value}</button>)}</div><label htmlFor="chat-answer">{questions[index]}</label><div className="composer-field"><textarea id="chat-answer" value={text} rows={2} maxLength={step === 'topic' ? 300 : step === 'subject' ? 160 : 40} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(text) } }} placeholder={kk ? 'Жауабыңызды жазыңыз…' : 'Напишите ответ…'}/><button type="submit" aria-label={kk ? 'Жіберу' : 'Отправить'} disabled={!text.trim()}>➤</button></div></form>}
    </> : <div className="practice-panel"><h2>{kk ? 'ҚМЖ бойынша тапсырмалар' : 'Задачи по КСП'}</h2>{selectedLesson ? <><label>{kk ? 'Жоспарды таңдаңыз' : 'Выберите план'}<select value={selectedLesson.id} disabled={busy} onChange={e => { setSelected(e.target.value); setError('') }}>{lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.topic} · {lesson.grade} · {lesson.subject}</option>)}</select></label><p>{kk ? 'Жауаптары мен бағалау критерийлері бар 5 тапсырма. Бір генерация жұмсалады.' : '5 заданий с ответами и критериями оценивания. Создание использует одну генерацию.'}</p><button className="button primary" disabled={busy} onClick={() => void run(() => tasks(selectedLesson))}>{practice.length ? (kk ? 'Жаңа нұсқа жасау' : 'Создать новый вариант') : (kk ? '5 тапсырма жасау' : 'Создать 5 заданий')}</button>{practice.map((task, i) => <article className="practice-task" key={i}><h3>{kk ? 'Тапсырма' : 'Задание'} {i + 1}</h3><p>{task.question}</p><details><summary>{kk ? 'Жауап және бағалау' : 'Ответ и оценивание'}</summary><p>{task.answer}</p><p>{task.assessment}</p></details></article>)}{practice.length > 0 && <button className="button secondary" onClick={() => { const body = practice.map((task, i) => `${i + 1}. ${task.question}\n\nОтвет: ${task.answer}\nОценивание: ${task.assessment}`).join('\n\n'); const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'tasks.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>{kk ? 'Тапсырмаларды жүктеу' : 'Скачать задания TXT'}</button>}</> : <p>{kk ? 'Алдымен чатта КСП жасаңыз.' : 'Сначала создайте КСП в чате. Затем здесь можно подготовить задания по нему.'}</p>}</div>}
    {busy && <p role="status" className="chat-bot-line">{kk ? 'TeacherBot дайындап жатыр…' : 'TeacherBot готовит материал… Обычно это занимает 10–15 секунд.'}</p>}
    {error && <p role="alert" className="has-error">{error}</p>}
  </section>
}

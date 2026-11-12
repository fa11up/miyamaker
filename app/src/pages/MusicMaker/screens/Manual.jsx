import { useState } from 'react'
import { ARTICLES, CATEGORIES, articleBy, articlesIn } from '../manualData.js'
import { model, touch } from '../model.js'
import { ChromeGlyph } from '../widgets.jsx'
import { CoachChip } from './Coach.jsx'

const LEVEL = {
  beginner: 'BEGINNER',
  intermediate: 'INTERMEDIATE',
  advanced: 'ADVANCED',
}

export function Manual() {
  const [slug, setSlug] = useState(null)
  const [chapters, setChapters] = useState(false)
  const article = slug ? articleBy(slug) : null

  function open(next) {
    setSlug(next)
    setChapters(false)
    const scroller = document.querySelector('[data-miya-music]')?.shadowRoot?.getElementById('manual-scroll')
    if (scroller) scroller.scrollTop = 0
  }

  return (
    <div className="manual">
      <header className="manual-bar">
        <button type="button" className="manual-home" onClick={() => open(null)}>
          Manual
        </button>
        {article && <span className="manual-crumb">/ {article.title}</span>}
        <button
          type="button"
          className="chrome-btn close manual-close"
          aria-label="Close"
          onClick={() => {
            model.fileWindow = ''
            touch(false)
          }}
        >
          <ChromeGlyph kind="close" />
        </button>
      </header>
      <div className="manual-body">
        <aside className="manual-side">
          <ChapterList slug={slug} onOpen={open} />
        </aside>
        <div className="manual-read" id="manual-scroll">
          {article ? <Article article={article} onOpen={open} /> : <Index onOpen={open} />}
        </div>
        <button type="button" className="btn free-width manual-chap" aria-expanded={chapters} onClick={() => setChapters((v) => !v)}>
          CHAP
        </button>
        {chapters && (
          <div className="manual-pop">
            <ChapterList slug={slug} onOpen={open} />
          </div>
        )}
      </div>
    </div>
  )
}

function ChapterList({ slug, onOpen }) {
  return (
    <>
      <button type="button" className={`manual-link${slug ? '' : ' on'}`} onClick={() => onOpen(null)}>
        INDEX
      </button>
      {CATEGORIES.map((cat) => {
        const list = articlesIn(cat.id)
        if (!list.length) return null
        return (
          <div key={cat.id} className="manual-group">
            <div className="manual-cat">{cat.label}</div>
            <ul>
              {list.map((item) => (
                <li key={item.slug}>
                  <button type="button" className={`manual-link${item.slug === slug ? ' on' : ''}`} onClick={() => onOpen(item.slug)}>
                    {item.slug === slug ? '▶ ' : ''}
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}

function Index({ onOpen }) {
  return (
    <>
      <h2>Manual</h2>
      <p className="manual-note">{ARTICLES.length} articles. Read any of them, in any order.</p>
      <p className="manual-note">Make music every day. A little time at the instrument keeps you creative, and it keeps you at one with God's creation.</p>
      <Rich text="The ? cards on each page show the buttons. This book is the longer version. The notes under each heading say what that part is. The keys are last, in [[Shortcuts]]. Start at [[Welcome]]." onOpen={onOpen} />
      {CATEGORIES.map((cat) => {
        const list = articlesIn(cat.id)
        if (!list.length) return null
        return (
          <section key={cat.id}>
            <h3>{cat.label}</h3>
            <p className="manual-note">{cat.blurb}</p>
            <ul className="manual-index">
              {list.map((item) => (
                <li key={item.slug}>
                  <button type="button" className="manual-link on" onClick={() => onOpen(item.slug)}>{item.title}</button>
                  <span className={`manual-level ${item.level}`}>{LEVEL[item.level]}</span>
                  <p>{item.one}</p>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

function Article({ article, onOpen }) {
  const also = (article.see || []).map((slug) => articleBy(slug)).filter(Boolean)
  return (
    <article>
      <h2>{article.title}</h2>
      <p className="manual-note">
        <span className={`manual-level ${article.level}`}>{LEVEL[article.level]}</span>
        {' '}
        {article.one}
      </p>
      {article.body.map((para) => <Rich key={para} text={para} onOpen={onOpen} />)}
      {also.length > 0 && (
        <div className="manual-also">
          <div className="manual-cat">SEE ALSO</div>
          {also.map((item) => (
            <button key={item.slug} type="button" className="manual-link on" onClick={() => onOpen(item.slug)}>
              {item.title}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

const CHIP = {
  FILE: { label: 'FILE', kind: 'btn' },
  NEW: { label: 'NEW', kind: 'btn' },
  SAVE: { label: 'SAVE', kind: 'btn' },
  Play: { label: 'Play', kind: 'btn' },
  Rec: { label: 'Rec', kind: 'rec' },
  Draw: { label: 'Draw', kind: 'btn' },
  Erase: { label: 'Erase', kind: 'btn' },
  Select: { label: 'Select', kind: 'btn' },
  Zoom: { label: 'Zoom', kind: 'btn' },
  Note: { label: 'Note', kind: 'btn' },
  Vel: { label: 'Vel', kind: 'btn' },
  'Bus FX': { label: 'Bus FX', kind: 'btn' },
  SHIFT: { label: 'SHIFT', kind: 'btn' },
  'Mint song': { label: 'Mint song…', kind: 'btn' },
  'Mint kit': { label: 'Mint kit…', kind: 'btn' },
  'Mint audio': { label: 'Mint audio…', kind: 'btn' },
  Welcome: null,
  Shortcuts: null,
}

function Rich({ text, onOpen }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g)
  return (
    <p>
      {parts.map((part, i) => {
        const named = part.match(/^\[\[(.+)\]\]$/)
        if (!named) return <span key={i}>{part}</span>
        const chip = CHIP[named[1]]
        if (chip) return <CoachChip key={i} label={chip.label} kind={chip.kind} />
        const linked = ARTICLES.find((item) => item.title === named[1])
        if (linked) {
          return (
            <button key={i} type="button" className="manual-link on" onClick={() => onOpen(linked.slug)}>
              {linked.title}
            </button>
          )
        }
        return <span key={i}>{named[1]}</span>
      })}
    </p>
  )
}

import { useConnectModal } from '@rainbow-me/rainbowkit'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { BigButton, Chip, StatusBox } from '@/components/Retro'
import { color, font, space, text } from '@/theme/tokens'

import type { NativeChat } from '../channels'
import { linkify, shortAddress } from './linkify'
import type { Badge, ChatMessage } from './protocol'
import { chatWaitLine, cleanText, codePoints, MAX_MESSAGE_LENGTH } from './protocol'
import { CHAT_URL, useChatRoom, useChatSession } from './useChat'

/** miyatv's chat, in the cabinet's dark walnut and cream. */
export const glow = {
  screen: '#1c130c',
  panel: '#2a1c11',
  line: '#5a3f25',
  ink: '#f3e7cf',
  muted: '#c8b392',
  name: '#f2a23c',
  link: '#ecd48a',
} as const

const Root = styled.section`
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  background: ${glow.panel};
  color: ${glow.ink};
  padding: ${space[1]};
  gap: ${space[1]};
  ${BigButton} {
    min-height: 40px;
    outline: none;
    border-radius: 5px;
    background: linear-gradient(180deg, #f8efd9 0%, #dccfae 100%);
    box-shadow:
      0 2px 0 #6d5c3c,
      inset 0 1px 0 #fff;
    color: #2a1a0e;
    font-size: ${text.sm};
    text-shadow: none;
  }
`

const Tabs = styled.div`
  display: flex;
  gap: 2px;
  button {
    flex: 1;
    min-height: 30px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid ${glow.line};
    border-radius: 4px 4px 0 0;
    background: transparent;
    color: ${glow.muted};
    cursor: pointer;
    font-size: ${text.xs};
    white-space: nowrap;
    .narrow & {
      min-height: 40px;
    }
  }
  button[aria-selected='true'] {
    background: ${glow.screen};
    color: ${glow.ink};
    font-weight: 700;
  }
`

/** The channel's panel. It scrolls only if it must, so no button is ever cut off; the chat below takes the room that is left. */
const Upper = styled.div`
  flex: 0 0 auto;
  max-height: 64%;
  overflow-x: hidden;
  overflow-y: auto;
  border-radius: 4px;
  box-shadow: 0 0 0 1px ${glow.line};
  .narrow & {
    max-height: 55%;
  }
  /* Typing on a phone: the keyboard has taken half the screen, so the chat takes the rest. */
  .narrow section:has(form input:focus) & {
    display: none;
  }
`

const Pane = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space[2]};
  padding: 0 ${space[1]};
  font-size: ${text.xs};
  color: ${glow.muted};
  min-width: 0;
  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const Log = styled.ol`
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: ${space[2]};
  list-style: none;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${glow.screen};
  font-family: ${font.body};
  font-size: 14px;
  line-height: 1.4;
  display: flex;
  flex-direction: column;
  gap: 6px;

  li {
    overflow-wrap: anywhere;
    color: ${glow.ink};
  }
  .from {
    font-family: ${font.mono};
    font-size: 12px;
    font-weight: 700;
    color: ${glow.name};
    margin-right: 6px;
  }
  .time {
    font-family: ${font.mono};
    font-size: 11px;
    color: ${glow.muted};
    margin-right: 6px;
  }
  a {
    color: ${glow.link};
  }
  .del {
    margin-left: 6px;
    border: none;
    background: none;
    color: #ff8fa3;
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
  }
  .empty {
    margin: auto;
    color: ${glow.muted};
    text-align: center;
    font-family: ${font.ui};
  }
`

const BadgeTag = styled.span<{ kind: Badge }>`
  display: inline-block;
  margin-right: 4px;
  padding: 0 4px;
  font-family: ${font.ui};
  font-size: 10px;
  line-height: 15px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  vertical-align: 1px;
  color: ${color.highlight};
  background: ${({ kind }) => (kind === 'mod' ? color.danger : kind === 'miyamini' ? color.accentDark : '#2d6a8f')};
  box-shadow: inset -1px -1px rgba(0, 0, 0, 0.35);
`

const Composer = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${space[1]};
  .row {
    display: flex;
    gap: ${space[1]};
  }
  input {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 ${space[2]};
    border: 1px solid ${glow.line};
    border-radius: 4px;
    background: ${glow.screen};
    color: ${glow.ink};
    font-size: 15px;
    font-family: ${font.body};
    /* Under 16px, iPhone Safari zooms the page when the field is pressed. */
    .narrow & {
      height: 40px;
      font-size: 16px;
    }
  }
  button[type='submit'] {
    min-width: 56px;
    border: 1px solid ${glow.line};
    border-radius: 4px;
    background: ${glow.line};
    color: ${glow.ink};
    cursor: pointer;
    &:active:not(:disabled) {
      transform: translateY(1px);
    }
    &:disabled {
      color: ${glow.muted};
      cursor: not-allowed;
    }
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: ${space[2]};
    font-size: ${text.xs};
    color: ${glow.muted};
  }
  .meta button {
    border: none;
    background: none;
    padding: 0;
    color: ${glow.link};
    cursor: pointer;
    font-size: ${text.xs};
    .narrow & {
      padding: 8px 4px;
    }
  }
  .over {
    color: #ff8fa3;
  }
`

const Frame = styled.iframe`
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: none;
  background: #0b0e0f;
  /* Kick's chat is its own page and cannot be restyled, but its colours can be tinted from out here. */
  filter: sepia(0.85) saturate(1.25) hue-rotate(-14deg) brightness(1.05);
`

const Offline = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space[2]};
  padding: ${space[4]};
  text-align: center;
  background: ${glow.screen};
  color: ${glow.muted};
  font-size: ${text.sm};
  strong {
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.md};
    color: ${glow.ink};
  }
  a {
    color: ${glow.link};
  }
`

const FreeLine = styled.p`
  margin: 0;
  text-align: center;
  font-size: ${text.xs};
  color: ${glow.muted};
`

const BADGE_LABEL: Record<Badge, string> = { mod: 'mod', miyamini: 'miyamini', infer: 'infer' }
const BADGE_TITLE: Record<Badge, string> = {
  mod: 'Moderator',
  miyamini: 'Holds a MIYAMINI',
  infer: 'Holds INFER',
}

const timeFmt = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function MessageText({ text: body }: { text: string }) {
  return (
    <>
      {linkify(body).map((seg, i) =>
        seg.kind === 'link' ? (
          <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}

function Line({ msg, canDelete, onDelete }: { msg: ChatMessage; canDelete: boolean; onDelete: (id: string) => void }) {
  return (
    <li>
      <span className="time">{timeFmt(msg.at)}</span>
      {msg.badges.map((b) => (
        // Own keys only: a badge named "constructor" must not pull a function out of the prototype.
        <BadgeTag key={b} kind={b} title={Object.hasOwn(BADGE_TITLE, b) ? BADGE_TITLE[b] : undefined}>
          {Object.hasOwn(BADGE_LABEL, b) ? BADGE_LABEL[b] : b}
        </BadgeTag>
      ))}
      <span className="from" title={msg.from}>
        {shortAddress(msg.from)}
      </span>
      <MessageText text={msg.text} />
      {canDelete && (
        <button
          type="button"
          className="del"
          aria-label="Delete message"
          title="Delete"
          onClick={() => onDelete(msg.id)}
        >
          ✕
        </button>
      )}
    </li>
  )
}

function OurChat({ room, roomLabel }: { room: string; roomLabel: string }) {
  const { address, session, signIn, cancelSignIn, signOut, signingIn, error: signInError } = useChatSession(CHAT_URL)
  const { openConnectModal } = useConnectModal()
  const chat = useChatRoom(CHAT_URL, room, session?.token)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = logRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.messages])

  // Errors fade after a few seconds (rate limit, slow mode...).
  const [visibleError, setVisibleError] = useState(chat.error)
  useEffect(() => {
    setVisibleError(chat.error)
    if (!chat.error) return undefined
    const ms = Math.max(4000, (chat.error.retryAfter || 0) * 1000)
    const t = setTimeout(() => setVisibleError(undefined), ms)
    return () => clearTimeout(t)
  }, [chat.error])

  // The server refused our token (expired, secret rotated): drop it so the user can sign in again.
  // Once per refusal: the error stays set after this, and acting on it again would sign out each new session as it arrives.
  const refusal = useRef(chat.error)
  useEffect(() => {
    if (chat.error?.code !== 'auth' || !session || refusal.current === chat.error) return
    refusal.current = chat.error
    signOut()
  }, [chat.error, session, signOut])

  if (!CHAT_URL) {
    return (
      <Offline role="status">
        <strong>Chat offline</strong>
        <span>{chatWaitLine('off')}</span>
      </Offline>
    )
  }

  const clean = cleanText(draft)
  const length = codePoints(clean)
  const over = length > MAX_MESSAGE_LENGTH
  const canSend = chat.status === 'open' && !!chat.me && length > 0 && !over

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    if (chat.send(clean)) {
      setDraft('')
      stick.current = true
    }
  }

  const statusChip =
    chat.status === 'open' ? (
      <Chip tone="ok">live</Chip>
    ) : chat.status === 'off' ? (
      <Chip tone="off">offline</Chip>
    ) : (
      <Chip tone="warn">{chat.status === 'connecting' ? 'connecting' : 'reconnecting'}</Chip>
    )

  return (
    <Pane>
      <Header>
        <span>
          #{roomLabel} · {chat.viewers} watching{chat.slowMode > 0 ? ` · slow mode ${chat.slowMode}s` : ''}
        </span>
        {statusChip}
      </Header>
      <Log
        ref={logRef}
        aria-live="polite"
        aria-label="miyaTV chat messages"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {chat.messages.length === 0 && <li className="empty">{chatWaitLine(chat.status)}</li>}
        {chat.messages.map((m) => (
          <Line key={m.id} msg={m} canDelete={!!chat.me?.mod} onDelete={chat.remove} />
        ))}
      </Log>
      {visibleError && (
        <StatusBox tone="error" role="alert">
          <span>
            {visibleError.message}
            {visibleError.retryAfter ? ` (try again in ${Math.ceil(visibleError.retryAfter)}s)` : ''}
          </span>
        </StatusBox>
      )}
      {signInError && (
        <StatusBox tone="error" role="alert">
          <span>{signInError}</span>
        </StatusBox>
      )}
      {session && chat.me ? (
        <Composer onSubmit={submit}>
          <div className="row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={chat.me.mod ? 'Say something (mods: /del, /timeout, /slow)' : 'Say something'}
              aria-label="Chat message"
              maxLength={MAX_MESSAGE_LENGTH * 2}
              enterKeyHint="send"
              autoComplete="off"
            />
            <button type="submit" disabled={!canSend}>
              Send
            </button>
          </div>
          <div className="meta">
            <span>
              as {shortAddress(chat.me.address)}{' '}
              <button type="button" onClick={signOut}>
                sign out
              </button>
            </span>
            <span className={over ? 'over' : undefined}>
              {length}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
        </Composer>
      ) : session ? (
        <StatusBox tone="info" role="status">
          {/* With the room down this could wait a long time, so there's a way out of it. */}
          <span>{chat.status === 'open' ? 'Signing you in to the room…' : chatWaitLine(chat.status)}</span>{' '}
          <button type="button" onClick={signOut}>
            Cancel
          </button>
        </StatusBox>
      ) : (
        <>
          <BigButton
            type="button"
            className="secondary"
            style={{ minHeight: 44, fontSize: text.sm, fontFamily: font.ui, letterSpacing: 0 }}
            disabled={signingIn}
            onClick={() => (address ? signIn() : openConnectModal?.())}
          >
            {signingIn ? 'Check your wallet…' : address ? 'Sign a free message to chat' : 'Connect wallet to chat'}
          </BigButton>
          {signingIn ? (
            <FreeLine>
              <button type="button" onClick={cancelSignIn}>
                Cancel
              </button>
            </FreeLine>
          ) : (
            address && <FreeLine>No gas. No permissions.</FreeLine>
          )}
        </>
      )}
    </Pane>
  )
}

export default function ChatPanel({
  room,
  roomLabel,
  channelId,
  native,
  panel,
}: {
  room: string
  roomLabel: string
  /** The channel on now: its panel changes with it, the chat below does not. */
  channelId: string
  native: NativeChat | undefined
  /** The channel's own panel, above the chat. */
  panel?: ReactNode
}) {
  const [tab, setTab] = useState<'ours' | 'native'>('ours')
  // miyatv chat comes first on every channel.
  useEffect(() => setTab('ours'), [channelId])
  const nativeTab = tab === 'native' && native

  return (
    <Root aria-label="Sidebar">
      {native && (
        <Tabs role="tablist">
          <button type="button" role="tab" aria-selected={!nativeTab} onClick={() => setTab('ours')}>
            miyaTV chat
          </button>
          <button type="button" role="tab" aria-selected={!!nativeTab} onClick={() => setTab('native')}>
            {native.label}
          </button>
        </Tabs>
      )}
      {nativeTab ? (
        <Frame
          key={native.src}
          src={native.src}
          title={native.label}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      ) : (
        <>
          {panel && <Upper key={channelId}>{panel}</Upper>}
          <OurChat room={room} roomLabel={roomLabel} />
        </>
      )}
    </Root>
  )
}

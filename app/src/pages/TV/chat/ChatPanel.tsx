import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styled from 'styled-components/macro'

import { BigButton, Chip, StatusBox } from '@/components/Retro'
import { bevel, color, font, space, text } from '@/theme/tokens'

import type { NativeChat } from '../channels'
import { linkify, shortAddress } from './linkify'
import type { Badge, ChatMessage } from './protocol'
import { cleanText, codePoints, MAX_MESSAGE_LENGTH } from './protocol'
import { CHAT_URL, useChatRoom, useChatSession } from './useChat'

const Root = styled.section`
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  background: ${color.face};
  box-shadow: ${bevel.raised};
  padding: ${space[1]};
  gap: ${space[1]};
`

const Tabs = styled.div`
  display: flex;
  gap: 2px;
  button {
    flex: 1;
    min-height: 30px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    cursor: pointer;
    font-size: ${text.sm};
    white-space: nowrap;
  }
  button[aria-selected='true'] {
    background: ${color.well};
    box-shadow: ${bevel.pressed};
    font-weight: 700;
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
  color: ${color.inkMuted};
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
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  font-family: ${font.body};
  font-size: 14px;
  line-height: 1.4;
  display: flex;
  flex-direction: column;
  gap: 6px;

  li {
    overflow-wrap: anywhere;
    color: ${color.ink};
  }
  .from {
    font-family: ${font.mono};
    font-size: 12px;
    font-weight: 700;
    color: ${color.accentDark};
    margin-right: 6px;
  }
  .time {
    font-family: ${font.mono};
    font-size: 11px;
    color: ${color.inkMuted};
    margin-right: 6px;
  }
  a {
    color: ${color.link};
  }
  .del {
    margin-left: 6px;
    border: none;
    background: none;
    color: ${color.danger};
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
  }
  .empty {
    margin: auto;
    color: ${color.inkMuted};
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
    border: none;
    border-radius: 0;
    background: ${color.well};
    box-shadow: ${bevel.field};
    font-size: 15px;
    font-family: ${font.body};
  }
  button[type='submit'] {
    min-width: 64px;
    border: none;
    background: ${color.face};
    box-shadow: ${bevel.raised};
    cursor: pointer;
    &:active:not(:disabled) {
      box-shadow: ${bevel.pressed};
    }
    &:disabled {
      color: ${color.shadow};
      cursor: not-allowed;
    }
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: ${space[2]};
    font-size: ${text.xs};
    color: ${color.inkMuted};
  }
  .meta button {
    border: none;
    background: none;
    padding: 0;
    color: ${color.link};
    cursor: pointer;
    font-size: ${text.xs};
  }
  .over {
    color: ${color.danger};
  }
`

const Frame = styled.iframe`
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: none;
  background: #0b0e0f;
  box-shadow: ${bevel.sunken};
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
  background: ${color.well};
  box-shadow: ${bevel.sunken};
  color: ${color.inkMuted};
  font-size: ${text.sm};
  strong {
    font-family: ${font.display};
    font-weight: 400;
    font-size: ${text.lg};
    color: ${color.ink};
  }
  a {
    color: ${color.link};
  }
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
        )
      )}
    </>
  )
}

function Line({ msg, canDelete, onDelete }: { msg: ChatMessage; canDelete: boolean; onDelete: (id: string) => void }) {
  return (
    <li>
      <span className="time">{timeFmt(msg.at)}</span>
      {msg.badges.map((b) => (
        <BadgeTag key={b} kind={b} title={BADGE_TITLE[b]}>
          {BADGE_LABEL[b] ?? b}
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
  const { address, session, signIn, signOut, signingIn, error: signInError } = useChatSession(CHAT_URL)
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
  useEffect(() => {
    if (chat.error?.code === 'auth' && session) signOut()
  }, [chat.error, session, signOut])

  if (!CHAT_URL) {
    return (
      <Offline role="status">
        <strong>chat offline</strong>
        <span>miyatv chat isn’t connected on this deployment yet. The stream still works.</span>
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
        aria-label={`${roomLabel} chat messages`}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {chat.messages.length === 0 && (
          <li className="empty">{chat.status === 'open' ? 'No messages yet. Say hi.' : 'Tuning in…'}</li>
        )}
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
          <span>Signing you in to the room…</span>
        </StatusBox>
      ) : (
        <BigButton
          type="button"
          className="secondary"
          style={{ minHeight: 44, fontSize: text.sm, fontFamily: font.ui, letterSpacing: 0 }}
          disabled={signingIn}
          onClick={() => (address ? signIn() : openConnectModal?.())}
        >
          {signingIn ? 'Check your wallet…' : address ? 'Sign in with Ethereum to chat' : 'Connect wallet to chat'}
        </BigButton>
      )}
    </Pane>
  )
}

export default function ChatPanel({
  room,
  roomLabel,
  native,
}: {
  room: string
  roomLabel: string
  native: NativeChat | undefined
}) {
  const [tab, setTab] = useState<'ours' | 'native'>('ours')
  const nativeTab = tab === 'native' && native

  return (
    <Root aria-label="Chat">
      <Tabs role="tablist">
        <button type="button" role="tab" aria-selected={!nativeTab} onClick={() => setTab('ours')}>
          miyatv chat
        </button>
        {native && (
          <button type="button" role="tab" aria-selected={!!nativeTab} onClick={() => setTab('native')}>
            {native.label}
          </button>
        )}
      </Tabs>
      {nativeTab ? (
        native.kind === 'iframe' ? (
          <Frame
            key={native.src}
            src={native.src}
            title={native.label}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
        ) : (
          <Offline>
            <strong>{native.label}</strong>
            <span>This platform’s chat can’t be embedded here.</span>
            <a href={native.href} target="_blank" rel="noopener noreferrer">
              Open it on {new URL(native.href).host.replace(/^www\./, '')} ↗
            </a>
          </Offline>
        )
      ) : (
        <OurChat key={room} room={room} roomLabel={roomLabel} />
      )}
    </Root>
  )
}

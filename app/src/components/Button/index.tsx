import { useConnectModal } from '@rainbow-me/rainbowkit'
import PatternBg from 'assets/bg_pattern.png?preset=pattern&resize=true'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import styled, { css } from 'styled-components/macro'

import { bevel, color, space, text } from '@/theme/tokens'
import { useAccount, useSwitchChain } from 'wagmi'

export const retroButton = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space[1]};
  cursor: pointer;
  background-color: ${color.face};
  color: ${color.ink};
  border: none;
  border-radius: 0;
  padding: 0 ${space[3]};
  min-height: 26px;
  min-width: 75px;
  font-size: ${text.sm};
  line-height: 1;
  text-decoration: none;
  user-select: none;
  box-shadow: ${bevel.raised};
  transition: background-color 80ms linear;

  &:hover:not(:disabled) {
    background-color: ${color.faceLight};
  }

  &:active:not(:disabled) {
    box-shadow: ${bevel.pressed};
    padding-top: 2px;
    padding-left: calc(${space[3]} + 1px);
  }

  &.free-width {
    min-width: auto;
    padding-left: ${space[1]};
    padding-right: ${space[1]};
  }

  &.free-height {
    min-height: auto;
  }

  &.heavy {
    outline: 1px solid ${color.dark};
    outline-offset: -1px;
    box-shadow: ${bevel.raised};
  }

  &.primary {
    background-color: ${color.accent};
    color: ${color.highlight};
    text-shadow: 1px 1px 0 ${color.accentDark};
    &:hover:not(:disabled) {
      background-color: #e48fe5;
    }
  }

  &.focus-taskbar {
    background-image: url(${PatternBg[0]?.src});
    background-repeat: repeat;
    box-shadow: ${bevel.pressed};
    font-weight: 700;
  }

  &:disabled,
  &[aria-disabled='true'] {
    cursor: not-allowed;
    color: ${color.shadow};
    text-shadow: 1px 1px 0 ${color.highlight};
    background-color: ${color.face};
  }
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const HighlightButton = styled.button<any>`
  ${retroButton}
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LinkButton = styled.a<any>`
  ${retroButton}
`

export const ButtonIcon = styled.button`
  border: none;
  background-color: transparent;
  cursor: pointer;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
`

export const ConnectedButton = ({
  style,
  children,
  withChain,
  disabled,
  onClick,
}: {
  style?: any
  children: ReactNode
  withChain?: number[]
  disabled?: boolean
  onClick: () => void
}) => {
  const { openConnectModal } = useConnectModal()
  const { isConnected, chain } = useAccount()
  const { chains, switchChain } = useSwitchChain()
  const correctChain = useMemo(() => {
    if (withChain !== undefined) {
      if (!chain?.id) return false
      return withChain.includes(chain.id)
    }

    return true
  }, [withChain, chain])

  const handleClick = () => {
    if (!isConnected && openConnectModal) {
      openConnectModal()
      return
    }

    if (withChain && !correctChain && withChain[0] !== undefined) {
      switchChain({ chainId: withChain[0] as (typeof chains)[number]['id'] })
      return
    }

    onClick()
  }

  const buttonText = useMemo(() => {
    if (!isConnected) return 'Connect wallet'
    if (!correctChain) {
      if (withChain?.length === 1) return `Switch to ${chains.find((el) => el.id === withChain?.[0])?.name}`
      return 'Switch to a supported chain'
    }

    return children
  }, [chains, children, correctChain, isConnected, withChain])

  const supportedChainNames = useMemo(() => {
    return withChain?.map((chainId) => chains.find((el) => el.id === chainId)?.name || chainId) || []
  }, [chains, withChain])

  return (
    <HighlightButton
      style={style}
      onClick={() => handleClick()}
      disabled={disabled}
      title={
        withChain?.length ? `This service supports the following chains: ${supportedChainNames.join(', ')} ` : undefined
      }
    >
      {buttonText}
    </HighlightButton>
  )
}

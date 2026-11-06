import type { CSSProperties, ReactNode } from 'react'
import { Fragment } from 'react'
import styled from 'styled-components/macro'

import { HighlightButton } from '@/components/Button'
import { NormalButton } from '@/components/Button/NormalButton'
import { Chip } from '@/components/Retro'
import mahoganySkin from '@/pages/Auction/skin/mahogany.webp'
import { paddleButton } from '@/pages/Auction/skin/paddle'
import paperSkin from '@/pages/Auction/skin/paper.webp'

const Wrapper = styled.fieldset`
  display: flex;
  /* fieldsets default to min-width: min-content, which pushes the window wider than a phone screen */
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  /* A page of the sale catalogue, with its printed double rule. */
  background: #f6eeda url(${paperSkin}) 0 0 / 256px 256px;
  color: #2a1410;
  border: 1px solid #a8843a;
  box-shadow: inset 0 0 0 3px #fbf5e4, inset 0 0 0 4px #c9a862, 0 3px 10px rgba(16, 2, 4, 0.6);
  padding: 0.5rem 1.5rem 1rem 1.5rem;

  @media only screen and (max-width: 640px) {
    padding: 0.5rem 0.5rem 0.75rem 0.5rem;
  }

  > legend {
    font-size: 0.7rem;
    display: flex;
    padding: 2px 0.6rem;
    border: 1px solid #c9a24c;
    background: #3b130c url(${mahoganySkin}) 0 0 / 256px 256px;
    color: #f4dd9c;
    text-transform: uppercase;

    > button {
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      text-transform: inherit;
      cursor: pointer;

      :hover {
        color: #fff6d6;
        text-decoration: underline;
      }

      :focus-visible {
        outline: 1px dotted #f4dd9c;
        outline-offset: 2px;
      }

      /* A bigger target on phones, without making the legend any taller. */
      @media only screen and (max-width: 640px) {
        padding: 10px 0;
        margin-top: -10px;
        margin-bottom: -10px;
      }
    }

    > * + * {
      margin-left: 0.5rem;
    }
  }

  * {
    font-family: Georgia, 'Times New Roman', serif;
    letter-spacing: 0;
  }
  > legend,
  > legend * {
    letter-spacing: 0.1em;
  }

  a {
    color: #7a1620;
  }

  /* A lot's status: a small printed tag. */
  ${Chip} {
    padding: 2px 4px;
    border: 1px solid #c9a862;
    border-radius: 2px;
    background: #fbf5e4;
    box-shadow: none;
    color: #5f4030;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  && ${NormalButton}, && ${HighlightButton} {
    ${paddleButton}
  }

  @media only screen and (max-width: 640px) {
    && ${NormalButton}, && ${HighlightButton} {
      min-height: 44px;
    }
  }
`

export default function ExplorerWrapper({
  style,
  title,
  setPageSection,
  children,
}: {
  style?: CSSProperties
  title: string
  setPageSection?: (section: string) => void
  children: ReactNode
}) {
  const handleClick = (item: string) => {
    if (setPageSection) setPageSection(item)
  }

  const renderTitle = () => {
    const titleSeparate = title.split('>').map((item) => item.trim())
    if (titleSeparate.length < 2) return <legend>{title}</legend>

    return (
      <legend>
        {titleSeparate.map((item, index) => {
          if (index === titleSeparate.length - 1) return <div key={index}>{item}</div>
          return (
            <Fragment key={index}>
              <button type="button" onClick={() => handleClick(item)}>
                {item}
              </button>
              <div> &gt; </div>
            </Fragment>
          )
        })}
      </legend>
    )
  }

  return (
    <Wrapper style={style}>
      {renderTitle()}
      {children}
    </Wrapper>
  )
}

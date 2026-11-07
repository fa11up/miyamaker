import { css } from 'styled-components/macro'

/** The sale room's buttons: gold leaf on a dark edge. */
export const paddleButton = css`
  border: 1px solid #6b4a12;
  border-radius: 2px;
  background: linear-gradient(180deg, #f6e3a4, #c9a24c);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), 0 1px 2px rgba(42, 20, 16, 0.4);
  color: #2a1006;
  &:hover:not(:disabled) {
    background: linear-gradient(180deg, #fff0c4, #d9b45b);
  }
  &:active:not(:disabled) {
    box-shadow: inset 0 2px 3px rgba(42, 20, 16, 0.45);
  }
  &:disabled {
    background: #e6dcc2;
    border-color: #b5a581;
    box-shadow: none;
    color: #8d7f62;
  }
`

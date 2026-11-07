# miyaOS rubric

## 1. Owner rules (already decided: breaking one is P2 or worse)

Layout
- Windows sit at a set, optimal width. No dragging a pane's width, no sideways scrolling inside a window.
- Nothing pokes past its frame or border, and nothing behind shows around it.
- Controls that join a frame blend into it: no visible seam.
- Opening or closing something must not make the page shift. Keep the scrollbar's room reserved if that is the cause.
- Phone: lists stack in one column. Nothing is shrunk to unreadable.

Buttons and navigation
- An app never opens another app. Only the desktop, the Start menu and the taskbar start apps. Each app boots on its own, with its own unique scene.
- One Connect wallet per view. Never two.
- A back button appears only when it can be used, and every page you can drill into has one.
- No Home button in Trade.
- A link only opens another site when the person pressed that link, never from clicking a picture or card.
- A secondary field appears only once the required fields above it are filled in.

Keep it short
- Remove "powered by" boxes and logos. Say it in one short line, or not at all.
- No promo lines inside a tool that send you to another app.
- No marketing sentences where a label will do.
- Credits only where a license needs them.

Pictures
- Real art from the project itself comes first. No blank placeholders where a real picture exists.
- Viewers keep every image at the same dimensions, and arrows step through the set.
- Popups and viewers take the look of the app they came from.

Skin
- Each app has its own look and its highlight colour. Textures should feel made: wood, gold, chrome, paper. Flat
  rectangles and fake-looking effects fail.
- It should look like a real program from 2001, never like a parody of one.

## 2. Money and safety (P1 when broken)

- Before any wallet prompt the screen says what will happen, how much, on which chain, and what it costs.
- Approvals ask only for what is being spent, and say so.
- Unverified things are labelled plainly, and scam items stay out of the main view.
- A refused, failed or restricted action says why in plain words and what to do next. Raw errors never reach the screen.
- Busy states stop double presses and say what they are waiting for. Prices that can go stale say so or refresh.
- The wrong chain is explained and fixable in one press.
- No price, yield or return promises anywhere. imdUSD is a dollar, not an investment.

## 3. Clear to a newcomer, fast for a collector

- Every screen answers: what is this, what do I do now, is it safe.
- Normal crypto words are fine (NFT, wallet, swap, floor, gas). Explain the rest once, in under ten words: pool, vault,
  alignment, operator, mint pass. One word for one thing across all the apps.
- Buttons say what they do: "Buy 1 for 0.2 ETH", not "Submit".
- Sentences stay short, about grade 8 or under. Numbers are rounded to what matters, with units.
- Empty states say why it is empty and offer the next step. Loading never looks like empty, and failure never looks like
  loading.
- Collector speed: common jobs take few presses, tables sort, values align, and a chosen place survives going back.

## 4. Looks good

- One primary action per view, visually strongest. Clear hierarchy, no more than three text sizes in one area.
- Contrast AA: 4.5:1 for body text and 3:1 for large text and controls, including text on textures.
- Spacing is consistent, and related things sit close. Long text wraps or truncates on purpose, with the full text available.
- Phone tap targets are 44px where possible, and never under 32px.
- Motion shows what changed, and respects reduced motion.

## 5. Works

- No page errors, failed same-site requests or broken images.
- Works on a phone from a cold load, with a slow network, with no wallet, and when an outside service is down.
- Keyboard: focus is visible, Escape closes what it opened, and shortcuts never fire while typing.
- Images have sensible alt text, and buttons with only an icon have a name.

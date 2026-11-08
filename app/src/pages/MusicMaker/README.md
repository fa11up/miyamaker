# MiyaMusicMaker

You can make music with this, even if you never have.

It is a drum machine, a little keyboard, and a pattern writer that live in the browser. Sixty-four pads are waiting. A starter kit is already loaded, and pattern 00 is a short demo. Press Play. Then change it until it sounds like yours.

You do not need to read music. You do not need a controller. The computer keyboard is enough to finish a song. A Launchpad, an MPC, an MPD, an MPK, or almost any other USB MIDI controller can play it too.

## Hear something in the first minute

1. Open the app and click the window once. The browser needs that click before it will make sound.
2. Press **Play**. The demo pattern loops.
3. Press **Stop**, then tap the pads. Each pad is one instrument.
4. Press **Play** again and tap along. If you like a part, press **Rec** and play it in. **Space** also starts and stops. **0** turns record on and off.

The pads on screen are the keys `1 2 3 4`, then `Q W E R`, then `A S D F`, then `Z X C V`. That is one bank of sixteen. Banks **A B C D** are the other instruments. `[` and `]` change bank.

Drop a sound file onto the window and it lands on the selected pad. You can also drag a row out of the browser onto a pad. The **<** button beside the browser hides that panel so the pages have the width. It turns into **>**, which opens the browser again.

On the Sample page, **Rec mic** records the microphone. A video link or a picture can become a sample too, from the **FILE** menu. None of that is required. The starter kit is already something you can play.

## Pad and Keys

The **Pad / Keys** switch is the whole instrument.

**Pad** plays drums. Each key, and each pad on a controller, is a different instrument.

**Keys** plays the selected pad as a melody. On the computer, `Z` is C, `Q` and comma are the next C, and `I` is the C above that. `A` and Caps Lock stop the note. The button shows the octave, like `Keys 3`. Numpad `/` and `*` move that octave.

Press `/` to flip between Pad and Keys. The small keyboard button next to them draws the map.

That is enough to make a beat and a bass line. Pick a drum pad, play it in Pad. Pick a tone you like, switch to Keys, and play a note at a time.

## The 64 instruments

Banks A, B, C, and D hold sixteen pads each. The pad you are on is the selected instrument. The Sample page trims it, tunes it, and sets how it plays: one shot, while you hold it, or looping. Pads in the same choke group cut each other off, which is how a closed hat silences an open hat.

The Synth page draws a sound and stores it on a pad. The Mixer page is four buses and the master. The FX page is ten performance slots. Hold Shift and a numpad digit while the song plays. Repeat locks one note value, from a half note to a 128th, to the project tempo and retriggers it. Slice rearranges a run of those notes. Grain sprays short pieces and is not a retrigger.

You can ignore every one of those pages until you want them.

## Trim a sample

Open the Sample page. The wave fills the space under the knobs. **S** and **E** are the start and the end of what plays. **LP** is where a held note starts looping. The handles stay thin.

Drag across the wave to draw a new span. When the span is already shorter than the sample, drag inside it and the whole span slides. Drag near either edge and that edge moves. Arrow keys nudge the handle you last touched.

Pinch the wave, or hold Ctrl and scroll, to zoom in. Once you are zoomed, the wheel pans along the sample. Double-click the wave, or press **Fit**, to see all of it again.

A yellow line is a voice that is playing this pad right now. Two hits at once are two lines. They move while the sound plays.

**Chop** copies the span between S and E onto the next empty pad. The pad you chopped stays as it was. The starter kit already uses pads 1 through 16, so the first chop lands on pad 17.

## Copy a pad

Right-click a pad and choose **Copy pad**. Right-click another pad and choose **Paste**. If that pad already has a sound, the menu says **Paste & replace**. On a phone or a tablet, hold the pad and the same menu opens above your finger. Copy takes the settings and the sample. Mute and solo on the pad you paste onto stay as they were.

## A pattern

The Sequence page and the Tracker page are the same song, two ways of looking at it.

There are 256 patterns, numbered `00` through `FF` in hex. Pattern length is the **Len** box, also in hex. `10` is sixteen steps. `20` is thirty-two. The box keeps what you type until you leave it or press Enter.

On the Pads page, `Y U I O` and `H J K L` jump between eight patterns. `{` and `}` change which group of eight you are in.

Record quantizes to the grid. There is a natural-feel option on the Sequence page when you want the hit to sit a little early or late.

## The tracker, when you want it

The Tracker is a spreadsheet of notes. Sixteen lanes run sideways. A cell is a note, an instrument, a velocity, and a tiny timing nudge.

Press Esc or Rec to edit. On a note, `Z` is C and `Q` is the next C. `A` is note off. The instrument column is the pad number in hex.

Shift and the arrows change the cell you are on, and the cursor stays there. On a note, Shift+Left and Shift+Right move one semitone. Shift+Up and Shift+Down move one octave. On the other columns, Shift+Up and Shift+Down change the left digit, and Shift+Left and Shift+Right change the right digit. The digits wrap. Left and Right on SL or LP walk each pair of digits before they leave the column.

**Step**, next to the tracker, is how many rows the cursor moves after you finish a value. Ctrl and `1` through `0` set it. `0` writes the cell and stays on the row. In Pad mode the pad keys write that pad as C-4 with velocity 80, from any column, then step. In Keys mode the same map as the keyboard writes notes, and only in the note column.

Delete or Backspace on MOVE sets the nudge to +00. The note stays. On SL or LP it clears only that column. On the note, the instrument, or the velocity, it clears the whole hit.

Right-click a column header and choose **Show/hide SL/LP columns** if you want the grain columns. They start blank. SL is where in the sample a hit begins. LP is how the play head walks through it. Hiding the columns keeps the numbers. You can make whole songs and never open them.

## Save the song

**SAVE** writes the song. **Save as** asks for a name and stores a `.m1ya` file. A `.k1t` file is only the kit: the pads, their sounds, and their settings. A song can carry a kit inside it, and it also stores the patterns, the mixer, and the FX.

**NEW** starts a song, a folder, a kit, or a slice. **FILE** opens songs and kits from the disk, from a link, or from sounds in a wallet.

On [miyamaker.com](https://www.miyamaker.com/) the same instrument can **Publish to Arweave** a song, a kit, or a bounce, and mint the song or kit as a music drop. Publishing is public and permanent: anyone can download the file, it can never be deleted, and a song or kit carries every sample in it, mic recordings too. Storage is paid in real ETH on Ethereum mainnet (files under about 90 KB are free), and the dialog shows the price before you press anything.

A copy you run yourself (`yarn dev`) does the same: it uploads to the real Arweave and pays real ETH. **SAVE** and **Save as** are the only ways to keep a file on this computer. Releasing on Sepolia uses test ETH for the collection, but storage is still paid in real ETH on mainnet.

## Plug in a controller

Click **MIDI** once, next to Pad and Keys, and allow the browser when it asks. You can plug the controller in before that or after. When it connects, the button lights and shows the device name. Hover it to see how that device was read.

Every note makes a sound. A pad plays an instrument. A note that is not on a pad plays the selected instrument at that pitch, so a keyboard can carry a melody while the pads play drums. Switch to **Keys** and the whole controller becomes the selected instrument, chromatically. Middle C, MIDI note 60, is the pad’s own pitch.

The computer keyboard keeps working at the same time.

### Launchpad

An 8×8 Launchpad is all 64 instruments at once in **Pad** mode.

The grid matches the screen. The top-left group of sixteen is bank A, in the same order as the pads you see. Bank B is the top-right group. Bank C is below A. Bank D is the bottom-right. You do not have to press A B C D to reach them. Those buttons only change what the screen shows.

In **Keys** mode the same grid is a chromatic keyboard. The bottom-left pad is C3. Each pad to the right is the next semitone, and the next row up continues the scale.

That map is the Session grid: the bottom-left pad sends note 11, and the top-left sends note 81. Launchpad X, Mini MK3, and Pro MK3 often wake up in Note mode, which sends musical pitches instead of that grid. Press **Session**, or choose the custom layout that uses the fixed grid (Custom 4 on many of these), when you want each pad to be its own instrument. If you stay in Note mode, **Keys** plays the pitches the Launchpad is already sending.

The round buttons down the right side are not instruments.

### MPC, MPD, and MPK

Akai pads use the usual map. Note 36 is the first instrument, the top-left pad of bank A. The notes walk left to right, then down the row, the same way the screen does.

On an MPC or MPD the bottom-left pad is usually note 36, so that physical pad plays the top-left instrument. Sixteen notes are one bank:

| Notes | Bank |
| --- | --- |
| 36–51 | A |
| 52–67 | B |
| 68–83 | C |
| 84–99 | D |

An MPK Mini, Play, or Plus has eight pads. Those play the first two rows. The rest of its keyboard plays the selected pad, so you can drum and play a line without leaving Pad mode. A larger MPK uses sixteen pads as bank A, and the keys do the same.

A few low keys on a mini can share note numbers with the pads. Move the keyboard’s octave, or switch the app to Keys, and those keys become melody.

### Any other controller

A Launchkey, a small keyboard, a pad grid, or a phone MIDI app is welcome. Notes 36 through 99 play the 64 instruments. Every other note plays the selected pad. Keys mode plays the selected pad from whatever note comes in.

If your pads are programmed to other note numbers, set them to start at 36, or play in Keys mode. Class-compliant USB MIDI needs no driver from this app. If the operating system can see the port, the browser can too.

### When the button says something else

**MIDI** means the browser has not been asked yet. Click it.

**MIDI · none** means MIDI is allowed and no controller is connected. Plug one in. You can do that after the app is open.

**MIDI · a name** means that device is live.

**MIDI blocked** means the site setting refused it. Allow MIDI for this page and click the button again.

**No MIDI** means this browser cannot see controllers. Chrome, Edge, Brave, Arc, and Opera can, on Mac, Windows, Linux, and ChromeOS. The page has to be on localhost or https. Safari and Firefox still play from the computer keyboard, which is a full way to write a song. On Linux, if a controller never appears, allow MIDI in the browser’s site settings.

The app listens to every input, and it notices a controller plugged in later. It does not need a special channel.

## Open it

From a checkout of this repository, on Mac, Windows, or Linux:

```bash
cd app
yarn
yarn dev
```

Yarn is the package manager this app ships with (`app/yarn.lock`). Node 18 or newer is enough. Open the MiyaMusicMaker window from the desktop. Its address is `/music`. Click the window once, press Play, and you are in.

Chrome, Edge, Brave, Arc, and Opera can see a USB MIDI controller on Mac, Windows, Linux, and ChromeOS. Use localhost or https. The computer keyboard plays in every browser, including Safari and Firefox.

The instrument is the files in this folder. Songs and kits stay in the browser until you save a `.m1ya` or `.k1t`. Save can also publish them to Arweave (public and permanent, paid in ETH on Ethereum) or mint them as a music drop.

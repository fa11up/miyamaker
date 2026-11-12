# MiyaMusicMaker

You can make music with this, even if you never have.

Make music every day. A little time at the instrument keeps you creative, and it keeps you at one with God's creation.

It is a drum machine, a little keyboard, and a pattern writer that live in the browser. Sixty-four pads are waiting. A starter kit is already loaded, and pattern 00 is a short demo. Press Play. Then change it until it sounds like yours.

You do not need to read music. You do not need a controller. The computer keyboard is enough to finish a song. A Launchpad, an MPC, an MPD, an MPK, or almost any other USB MIDI controller can play it too.

Version 1.0.0 also runs as its own program. On a Mac, download the GitHub release `MiyaMusicMaker-v1.0.0`, unzip it, and the first time right-click the app and choose Open. Windows and Linux build from the same source. The steps are in [the desktop guide](../../../../desktop/miyamusicmaker/README.md).

## What the pages are

These are the parts of the instrument. The keys come after, once the pages make sense.

**Pads** are drums. Sixteen pads are one bank. Banks A, B, C, and D are sixty-four instruments.

**Keys** plays the selected pad as a melody, one note at a time.

**Chords** chooses a harmony. The buttons do not play. The piano plays that chord, and the strip above it plays one note.

**Sequence** is the beat, painted on the pad rows. Its tools sit in the left rail when that rail has room. **Tracker** is the same pattern as a spreadsheet. The row in the middle is the one you are hearing or editing.

**Arranger** chains patterns into a song. A new part waits until the one that is playing finishes.

**Sample** trims the wave on a pad. **Synth** draws a new sound onto a pad. **Mixer** balances sixteen buses. **FX** is an effect you hold while the song plays.

On a phone the same pages stay. SHIFT sits where a thumb can hold it, and the pads stay in reach.

## Hear something in the first minute

1. Open the app and click the window once. The browser needs that click before it will make sound.
2. Press **Play**. The demo pattern loops.
3. Press **Stop**, then tap the pads. Each pad is one instrument.
4. Press **Play** again and tap along. If you like a part, press **Rec** and play it in. **Space** also starts and stops. **0** turns record on and off.

The pads on screen are the keys `1 2 3 4`, then `Q W E R`, then `A S D F`, then `Z X C V`. That is one bank of sixteen. Banks **A B C D** are the other instruments. `[` and `]` change bank.

Drop a sound file onto the window and it lands on the selected pad. You can also drag a row out of the browser onto a pad. The top button on the left rail hides the sample browser. The button under it opens the arranger. With both open, the bar between them drags. The buttons open and close that column.

On the Sample page, **Rec mic** records the microphone. A video link or a picture can become a sample too, from the **FILE** menu. The video window crops the in and out points, downsamples, slices a long clip, and can put the result on a pad right away. A start time in the link is the suggested in point. None of that is required. The starter kit is already something you can play.

## Pad and Keys

The **Off / Pads / Keys** button is the whole instrument. **Off** hides the on-screen pads and keys on a narrow window and keeps the last map for a hardware keyboard.

**Pad** plays drums. Each key, and each pad on a controller, is a different instrument.

**Keys** plays the selected pad as a melody. On the computer, `Z` is C, `Q` and comma are the next C, and `I` is the C above that. `A` and Caps Lock stop the note. The button shows the octave, like `Keys 3`. Numpad `/` and `*` move that octave.

Press `/` to cycle Off, Pads, Keys, Chords, and Strum. On a phone it also reaches FX. The surface button in the top row cycles the same list. Hold that button, right-click it, or Shift-click it, and the list opens. The **?** button on a page draws the map and the other notes.

That is enough to make a beat and a bass line. Pick a drum pad, play it in Pad. Pick a tone you like, switch to Keys, and play a note at a time.

## The chord panel

Chords is the third on-screen palette, beside Keys and Strum. Open it from the surface button in the top row. That button cycles the palettes. Hold it, right-click it, or Shift-click it to open the list. Drag the bar above the panel if you want it taller.

The panel is three regions, left to right, with a small gap between them.

The pitch wheel is the narrow column on the left. Push it up and the note you are holding goes sharp. Push it down and the note goes flat. Let go and it springs back to the center line. The default reach is two octaves up and two octaves down. **Set**, the small button at the top left of the panel, changes that reach, one semitone at a time, and it will not go past two octaves.

The fifteen buttons are the harmony. They are three columns and five rows. They do not play a sound by themselves. They choose what the piano on the right will play. **A**, **B**, and **C** under the grid are banks, in the same way the pad banks are. A is chord types. B is modes. C is other scales. A name that does not fit scrolls inside the button. Press the lit button again to clear it. With nothing chosen, the piano plays a major chord on the key you touch. The strip above it is every half step, and a touch there plays that one note. The keys do not play single notes.

The right side is a lead strip over a piano.

The strip is the melody. Its divisions follow the harmony you chose, and they retune as soon as the root or that harmony changes. A major chord lays out the major scale. A mode or another scale lays out that scale. The root stripe is pink and named for the current root. The default span is four octaves around the root:

| Place on the strip | Note |
| --- | --- |
| Left edge | One octave under the root |
| A quarter of the way | The root |
| The middle | One octave above the root |
| Three quarters | Two octaves above the root |
| Right edge | Three octaves above the root |

A small mark on the strip is an octave of the root. **Set** can move the low end and the high end. The low end stays within three octaves under the root. The high end stays within six octaves above it, and it always stays above the low end.

The piano under the strip is an ordinary keyboard, with rounded keys and a shine on the face. On a wide window, and on a large tablet, it runs C3 through C5. On a phone, including landscape, it is one octave, C3 through C4. The harmony buttons stop at the left third of the panel, and that one octave fills the rest. The key you touch becomes the root, and it sounds the whole chord in that octave: the chord button you lit, or degrees 1, 3, and 5 of a scale, or a major chord if nothing is lit. The lead strip is the single notes. Touch higher on a key and the note is quieter. Touch lower and it is louder. That up-and-down position is velocity unless you change it. **Set** can point it at the filter or the pan instead. Those choices stay in the menu.

SHIFT stays in the left strip, and a coral bar marks it, on the chord panel as well as the other pages. Hold SHIFT and drag the tracker with the other thumb to edit the cell. Hold it with a numpad slot, then − or +, and the knobs on that slot bend. Shift-click the surface button to open its list. The bank letter above the wheel opens the three harmony banks, so that row stays off the phone face. The left strip itself is only a Tabs button, plus SHIFT. Browser, Arranger, Manual, and MIDI stay inside Tabs, so the strip stays narrow. Keys keeps a pitch wheel in that strip, above SHIFT. Strum has a Scale button. It marks the root, the chord, and the scale on the strings, the same ones chosen here, and it does not play them.

**Set** also holds the tuning (Equal, Just, Pythagorean, meantone, Werckmeister) and the inversion of a chord.

This layout is the one drawn in [@koolskull’s post on 11 Nov 2026](https://x.com/koolskull/status/2120560722858197426): a pitch wheel, chord buttons that set the harmony, and a four-octave lead strip over a root piano. The note under that drawing, [the reply the same day](https://x.com/koolskull/status/2120562507899453673), says the panel is the simple shape of a Korg Gadget chord page, the strip is there because of the Omnichord, and it is not trying to be the Orchid by Telepathic Instruments. Keys, Chords, and Strum stay three separate screens.

The description in this section is open source under the [Source Seppuku License](https://wiki.remilia.org/Source_Seppuku_License). The rest of this program stays under the license named in the repository README.

## The 64 instruments

Banks A, B, C, and D hold sixteen pads each. The pad you are on is the selected instrument. The Sample page trims it, tunes it, and sets how it plays: one shot, while you hold it, or looping. Pads in the same choke group cut each other off, which is how a closed hat silences an open hat.

The Synth page draws a sound and stores it on a pad. While that page is open, the on-screen keys, the chord piano, the strum plate, and a MIDI note play the patch you are editing. **Take** records that playing into 64 KB. 8-bit is the longest, about a second and a half. 32-bit is the shortest, under half a second. 16-bit and 24-bit sit between them. **Take to pad** stores the recording on the selected pad. **Render to pad** still stores the patch itself. The Mixer page is sixteen buses and the master. The FX page is ten performance slots. Hold Shift and a numpad digit while the song plays, or hold the on-screen numpad key on that page. Repeat locks one note value, from a half note to a 128th, to the project tempo and retriggers it. Slice rearranges a run of those notes. Grain sprays short pieces and is not a retrigger. Tracker notes play once. A one-shot plays once even while the pad is held. Gate lasts only as long as the hold. Loop repeats from LP to the end until you let go.

You can ignore every one of those pages until you want them.

## Trim a sample

Open the Sample page. The wave fills the space under the knobs. **S** and **E** are the start and the end of what plays. **LP** is where Loop mode repeats, from that point to the end. One-shot never uses it. The handles stay thin.

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

Quantize, in the top bar, records MOVE when it is on: how far a hit sits from its step. Off leaves that movement out. Velocity and a pitch bend still write.

Snap, on the Sequence page, is the grid those notes land on. Click it to turn Snap off. Hold it, right-click it, or Shift-click it for the division: 1/4, 1/8, 1/16, 1/32, 1/64, or 1/128. A bar is sixteen steps, so 1/16 is one step. Snap on lands the note and its end on that division. Snap off lets the note sit between steps, and End lets it finish anywhere inside a step. The start is the MOVE column in the tracker, and it stays when you go from one page to the other.

Draw, Erase, Snap, − bar, + bar, Double, and the note tools sit in the left rail when that rail has room. The pattern, the step count, and Swing stay on top. SHIFT stays at the bottom of the rail.

## Arrange the song

The left column is the sample browser. The button under it opens the arranger in the same column. With both open, drag the bar between them. The buttons open and close that column. On a narrow window, opening one closes the other, and each takes the full width of its area.

**+ pattern** opens four banks, `00–3F`, `40–7F`, `80–BF`, and `C0–FF`. Pick a slot, named or empty. The new part is a cell in the song order. Click the cell to launch it. **Wait** holds the launch until the part that is playing finishes. **Now** starts it as soon as you tap it. **Grid** switches on the beat and keeps the step. **Order** walks the cells and returns to the first. **Once** plays through and stops. **Loop** on a cell repeats that section.

The bar along the bottom of a cell is the loop position. Only the cell that is actually playing fills it, from the first step to the last. That cell does not blink. Its mark turns accent, and the line under the name counts the step, such as `9/16`. A cell you have selected while another loop is still going stays empty and blinks on the beat until the current loop ends and it starts. Right-click a cell, or use its menu button, for Edit, Duplicate, and Delete. Removing a cell leaves the pattern where it is.

## The mixer

All sixteen buses sit in one row. On a phone they wrap, four to a row, and the page scrolls down. Tap a channel and its five effect slots follow. Soloing a channel lights the red mute button on every other channel. Those lights go out when the solo does. The EQ under the slots follows that channel too. Its header can point the EQ at another channel or at the output.

The graph runs from low cut on the left to high cut on the right. Drag a point to tune it. Right-click a point, or hold SHIFT and tap it, to choose low cut, bell, or high cut, and to make that band duck when it gets loud. Tap the channel name above the effect slots to hide those knobs. The compressor after the EQ draws the gain it is taking off. MB at the end of its header turns that compressor into four bands. Drag a divider to move the split, or drag inside a band to set its threshold. A limiter sits after the master compressor and does not pass 0 dBFS.

## On a phone

A narrow window keeps one row: Menu, Play, Rec, Quantize, the tempo, the surface, one bank, and one screen. Quantize on records MOVE, how far a note sits from the step. Quantize off does not record movement. Velocity and pitch bend still write. Menu holds the file commands, save, export, and mint. The surface button cycles Off, Pads, Keys, Chords, Strum, and FX. Hold it, right-click it, or Shift-click it, and that list opens. Pads and keys sit at the bottom, where a thumb can reach them. The left strip is narrow. Tabs at the top of it keeps Browser, Arranger, Manual, and MIDI. The sequence tools stack in that strip when it has room. The pattern, the step count, and Swing stay on top. SHIFT sits at the lower left, marked with a coral bar, on every page including chords. The root piano there is one octave. Hold SHIFT and drag the tracker with the other thumb.

Hold Shift and Ctrl, then an arrow, to change page. One press moves one screen. On a PlayStation pad hold R1 and Triangle, on Switch hold R and X, on Xbox hold RB and Y, then press the d-pad or the left stick. The d-pad alone moves like the arrow keys.

## The manual

The **?** on a page opens a short card. Show me draws a line to the real button. **FILE**, then **Manual**, opens the longer book. On a narrow window the same item is inside Menu. The book is Foundations, The song, Sounds, Going further, and Reference.

## The tracker, when you want it

The Tracker is a spreadsheet of notes. Sixteen lanes run sideways. A cell is a note, an instrument, a velocity, and a tiny timing nudge.

Press Esc or Rec to edit. On a note, `Z` is C and `Q` is the next C. `A` is note off. The instrument column is the pad number in hex. While Rec is on, the on-screen pads, the piano keys, and the chord piano write into this pattern from any page. Each note of a chord takes the next lane of that step. The sequence page stacks those notes on that pad’s row.

Shift and the arrows change the cell you are on, and the cursor stays there. On a note, Shift+Left and Shift+Right move one semitone. Shift+Up and Shift+Down move one octave. On the other columns, Shift+Up and Shift+Down change the left digit, and Shift+Left and Shift+Right change the right digit. The digits wrap. Left and Right on SL or LP walk each pair of digits before they leave the column.

**Step**, next to the tracker, is how many rows the cursor moves after you finish a value. Ctrl and `1` through `0` set it. `0` writes the cell and stays on the row. In Pad mode the pad keys write that pad as C-4 with velocity 80, from any column, then step. In Keys mode the same map as the keyboard writes notes, and only in the note column.

Delete or Backspace on MOVE sets the nudge to +00. The note stays. On SL or LP it clears only that column. On the note, the instrument, or the velocity, it clears the whole hit.

Right-click a column header and choose **Show/hide SL/LP columns** if you want the grain columns. They start blank. SL is where in the sample a hit begins. LP is how the play head walks through it. Hiding the columns keeps the numbers. You can make whole songs and never open them.

## Save the song

**SAVE** writes the song. **Save as** asks for a name and stores a `.m1ya` file. A `.k1t` file is only the kit: the pads, their sounds, and their settings. A song can carry a kit inside it, and it also stores the patterns, the mixer, and the FX.

**NEW** starts a song, a folder, a kit, or a slice. **FILE** opens songs and kits from the disk, from a link, or from a wallet. A png or a jpg on a token can become a sample, and Make a kit fills up to 16 pads from Milady pictures in that wallet.

On [miyamaker.com](https://www.miyamaker.com/) the same instrument can **Publish to Arweave** a song, a kit, or a bounce, and mint the song, the kit, or the bounce as an edition. **Mint song** stores the bounce and the `.m1ya`. **Mint kit** stores the bounce and the `.k1t`. **Mint audio** stores the bounce only. The bounce can play in miya radio. Publishing is public and permanent: anyone can download the file, it can never be deleted, and a song or kit carries every sample in it, mic recordings too. Storage is paid in real ETH on Ethereum mainnet (files under about 90 KB are free), and the dialog shows the price before you press anything.

An edition asks for a bonding curve before it is released. **Gentle** is the default: each copy costs 1% more than the one before it. **Steady** is 2.5%, **Steep** is 5%, and **Custom** is a percent you type, up to 100%. **Flat** keeps one price, which is what an open edition needs. A rising curve needs a copy count above zero. The curve is stored with the edition and cannot be changed after release. A fixed-price drop and an auction do not use it. Drop Music, Launch, and Manager ask for the same curve when they release an edition.

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

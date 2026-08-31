# Survey mark

Chosen 2026-08-30 after a ten-judge review of four candidates.

## The files

| File | Use |
|---|---|
| `survey-mark.svg` | Primary. Inherits colour from CSS — prefer this in the app. |
| `survey-mark-gold.svg` | Primary, #d8a84e. Dark grounds only. |
| `survey-mark-brass.svg` | Primary, #654500. Light grounds. |
| `survey-mark-small.svg` | Under 24px. Favicon, 22px sidebar, square filled tiles. |
| `survey-mark-small-gold.svg` | As above, gold, dark grounds. |
| `survey-mark-bimi.svg` | Email sender avatar only. The one file with a background. |

## The rules

- **One stroke weight.** 48 in the primary, 52 in the small cut. Never mix two.
- **The gap is drawn, not left over.** The space between the two bars is 56 against a
  48 stroke. Tightening it is what made the old mark smear at favicon size.
- **Gold never touches a light ground.** #d8a84e on the cream #f4f1ea is 1.95:1,
  below the 3:1 floor for graphics. Light grounds get the brass #654500 (4.61:1).
- **No white plate.** Every file above ships transparent except the BIMI one, which
  is required to carry a background.
- **The small cut is not for circular crops.** It is tangent to the crop circle, so
  the ring's cardinal points clip. Use the primary inside avatars and OAuth cards.
- **Never break the ring into arcs.** A segmented ring reads as a loading spinner,
  and the app renders a real sync indicator in the same rail at the same size.

## What changed from the old mark

Two stroke weights became one. The ring grew from radius 186 to 216 so the drawing
fills its square instead of wasting margin. The third bar was dropped and the
remaining two spaced further apart. The four ticks were lengthened so they protrude
past the ring and survive at 16px — previously they overlapped the ring band and
disappeared below about 28px.

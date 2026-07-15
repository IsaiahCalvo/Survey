# Paper.js Vector Eraser Demo

Static demo for testing the eraser behavior from beardicus' Paper.js Vector Erase gist:
https://gist.github.com/beardicus/8cbe9511d43e3fb58d76e336f76f4eb2

Run from this folder:

```sh
python3 -m http.server 5187
```

Then open:

```text
http://localhost:5187/
```

The page loads Paper.js from unpkg.

This version converts pen strokes into filled outline geometry before erasing. That lets the eraser subtract a smaller circle from the side of a thicker stroke and leave a real rounded concave bite instead of deleting the whole stroke or only masking pixels.

Erase mode:

- `Partial erase`: subtracts eraser geometry from touched ink shapes.
- `Full erase`: deletes any touched ink shape.

Use the Sloppiness slider to trade precision for simpler geometry. `0` keeps dense points and minimal simplification; `100` aggressively thins and simplifies the generated ink shape.

Shortcuts:

- `P`: pen
- `E`: erase
- `V`: select/move
- Hold `Space`: temporary pan
- Trackpad/wheel over the canvas: zoom

import { useMemo, useState } from 'react';
import { MobileToolProperties } from '../mobile/MobilePdfViewerChrome';

const INITIAL_STATE = {
  fontColor: '#1e293b',
  fontFamily: 'Arial',
  fontSize: 16,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  verticalAlign: 'top',
  textAlign: 'left',
};

export default function MobileTextFormattingHarness() {
  const mode = new URLSearchParams(window.location.search).get('mobileTextFormattingHarness') || 'text';
  const [formatting, setFormatting] = useState(INITIAL_STATE);
  const [strip, setStrip] = useState({ eraserMode: 'partial', borderStyle: 'solid', arrowheadStyle: 'solidTriangle' });
  const update = (patch) => setFormatting((current) => ({ ...current, ...patch }));
  const api = useMemo(() => {
    if (mode === '1' || mode === 'text') {
      return {
        activeTool: 'text',
        contextTool: 'text',
        richTextEditor: {
          state: formatting,
          api: {
            setFontColor: (fontColor) => update({ fontColor }),
            setFontFamily: (fontFamily) => update({ fontFamily }),
            setFontSize: (fontSize) => update({ fontSize }),
            toggleBold: () => update({ bold: !formatting.bold }),
            toggleItalic: () => update({ italic: !formatting.italic }),
            toggleUnderline: () => update({ underline: !formatting.underline }),
            toggleStrike: () => update({ strike: !formatting.strike }),
            setTextAlign: (textAlign) => update({ textAlign }),
            setVerticalAlign: (verticalAlign) => update({ verticalAlign }),
          },
        },
      };
    }
    return {
      activeTool: mode,
      contextTool: mode,
      eraserMode: strip.eraserMode,
      eraserSizeInputValue: '24',
      setEraserMode: (eraserMode) => setStrip((current) => ({ ...current, eraserMode })),
      handleEraserSizeInputChange: () => {},
      handleEraserSizeInputBlur: () => {},
      strokeWidthInputValue: '4',
      strokeColor: '#ff0000',
      fillColor: '#ffffff',
      handleStrokeWidthInputChange: () => {},
      handleStrokeWidthInputBlur: () => {},
      handleStrokeColorChange: () => {},
      handleFillColorChange: () => {},
      lineBorderStyle: strip.borderStyle,
      setLineBorderStyle: (borderStyle) => setStrip((current) => ({ ...current, borderStyle })),
      arrowheadStyle: strip.arrowheadStyle,
      setArrowheadStyle: (arrowheadStyle) => setStrip((current) => ({ ...current, arrowheadStyle })),
    };
  }, [formatting, mode, strip]);

  return (
    <main style={{ width: 390, minHeight: 180, marginTop: 24, position: 'relative', background: '#0d0f14' }}>
      <MobileToolProperties api={api} />
      <output data-testid="formatting-state" style={{ position: 'absolute', top: 70, left: 12, color: 'white' }}>
        {JSON.stringify(mode === '1' || mode === 'text' ? formatting : strip)}
      </output>
    </main>
  );
}

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
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mobileTextFormattingHarness') || 'text';
  const selected = params.get('selected') === '1';
  const [formatting, setFormatting] = useState(INITIAL_STATE);
  const [strip, setStrip] = useState({
    eraserMode: 'partial',
    eraserSize: '24',
    borderStyle: 'solid',
    arrowheadStyle: 'solidTriangle',
    strokeWidth: '4',
    strokeColor: '#ff0000',
    strokeOpacity: 100,
    fillColor: '#ffffff',
    fillOpacity: 100,
    counterSeriesId: 'series-a',
    counterStart: 1,
  });
  const update = (patch) => setFormatting((current) => ({ ...current, ...patch }));
  const api = useMemo(() => {
    if (mode === '1' || mode === 'text') {
      return {
        activeTool: selected ? 'select' : 'text',
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
      activeTool: selected ? 'select' : mode,
      contextTool: mode,
      eraserMode: strip.eraserMode,
      eraserSizeInputValue: strip.eraserSize,
      setEraserMode: (eraserMode) => setStrip((current) => ({ ...current, eraserMode })),
      handleEraserSizeInputChange: ({ target }) => setStrip((current) => ({ ...current, eraserSize: String(target.value) })),
      handleEraserSizeInputBlur: ({ currentTarget }) => setStrip((current) => ({ ...current, eraserSize: String(currentTarget.value) })),
      strokeWidthInputValue: strip.strokeWidth,
      strokeColor: strip.strokeColor,
      strokeOpacity: strip.strokeOpacity,
      fillColor: strip.fillColor,
      fillOpacity: strip.fillOpacity,
      handleStrokeWidthInputChange: ({ target }) => setStrip((current) => ({ ...current, strokeWidth: String(target.value) })),
      handleStrokeWidthInputBlur: ({ currentTarget }) => setStrip((current) => ({ ...current, strokeWidth: String(currentTarget.value) })),
      handleStrokeColorChange: (strokeColor) => setStrip((current) => ({ ...current, strokeColor })),
      handleStrokeOpacityChange: (strokeOpacity) => setStrip((current) => ({ ...current, strokeOpacity })),
      handleFillColorChange: (fillColor) => setStrip((current) => ({ ...current, fillColor })),
      handleFillOpacityChange: (fillOpacity) => setStrip((current) => ({ ...current, fillOpacity })),
      lineBorderStyle: strip.borderStyle,
      setLineBorderStyle: (borderStyle) => setStrip((current) => ({ ...current, borderStyle })),
      arrowheadStyle: strip.arrowheadStyle,
      setArrowheadStyle: (arrowheadStyle) => setStrip((current) => ({ ...current, arrowheadStyle })),
      activeCounterSeriesId: strip.counterSeriesId,
      counterSeriesList: [
        { seriesId: 'series-a', label: 'Doors', count: 1, color: '#ff0000' },
        { seriesId: 'series-b', label: 'Windows', count: 4, color: '#4A90E2' },
      ],
      onNewCounterSeries: () => setStrip((current) => ({ ...current, counterSeriesId: 'series-new' })),
      onSwitchCounterSeries: (counterSeriesId) => setStrip((current) => ({ ...current, counterSeriesId })),
      selectedCounterSeriesSize: 1,
      selectedCounterSeriesStart: strip.counterStart,
      onSelectedCounterSeriesStartChange: (counterStart) => setStrip((current) => ({ ...current, counterStart: Number(counterStart) })),
    };
  }, [formatting, mode, selected, strip]);

  return (
    <main style={{ width: 390, minHeight: 180, marginTop: 24, position: 'relative', background: '#0d0f14' }}>
      <MobileToolProperties api={api} />
      <output data-testid="formatting-state" style={{ position: 'absolute', top: 70, left: 12, color: 'white' }}>
        {JSON.stringify(mode === '1' || mode === 'text' ? formatting : strip)}
      </output>
    </main>
  );
}

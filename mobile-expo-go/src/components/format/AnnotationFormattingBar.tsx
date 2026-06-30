import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { Check, Eraser, Square, X } from 'lucide-react-native';
import type { SurveyModule } from '@survey/shared';
import type { AnnotationEditConfig, AnnotationEditFocus, LineBorderStyle, ArrowheadStyle, EraserMode, ToolId, CounterSeries, FormatPanelMode } from '../../types';
import { colors, arrowheadStyleLabels, lineBorderStyleLabels, eraserModeLabels, counterSeriesColors } from '../../constants';
import { styles } from '../../styles';
import { FormatColorSwatch, FormatNumberInput, FormatMenuButton, FormatDropdownButton } from './FormatPrimitives';


export function AnnotationFormattingBar({
  activeTool,
  visible,
  surveyToolbarActive,
  regionToolbarActive,
  regionFullPageConfirmOpen,
  mode,
  setMode,
  railWidth,
  topOffset,
  surveyModules,
  selectedSurveyModuleId,
  onSelectSurveyModule,
  surveyKeepCategoryActive,
  setSurveyKeepCategoryActive,
  onRegionConfirm,
  onRegionCancel,
  onRegionFullPage,
  onRegionFullPageConfirm,
  onRegionFullPageCancel,
  onOpenEditPanel,
}: {
  activeTool: ToolId;
  visible: boolean;
  surveyToolbarActive: boolean;
  regionToolbarActive: boolean;
  regionFullPageConfirmOpen: boolean;
  mode: FormatPanelMode;
  setMode: React.Dispatch<React.SetStateAction<FormatPanelMode>>;
  railWidth: number;
  topOffset: number;
  surveyModules: SurveyModule[];
  selectedSurveyModuleId: string | null;
  onSelectSurveyModule: (moduleId: string) => void;
  surveyKeepCategoryActive: boolean;
  setSurveyKeepCategoryActive: React.Dispatch<React.SetStateAction<boolean>>;
  onRegionConfirm: () => void;
  onRegionCancel: () => void;
  onRegionFullPage: () => void;
  onRegionFullPageConfirm: () => void;
  onRegionFullPageCancel: () => void;
  onOpenEditPanel: (config: AnnotationEditConfig) => void;
}) {
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [fillColor, setFillColor] = useState('#ff0000');
  const [fontColor, setFontColor] = useState('#1e293b');
  const [strokeWidthValue, setStrokeWidthValue] = useState('3');
  const [eraserSizeValue, setEraserSizeValue] = useState('16');
  const [eraserMode, setEraserMode] = useState<keyof typeof eraserModeLabels>('partial');
  const [counterSeriesList, setCounterSeriesList] = useState<CounterSeries[]>([
    { seriesId: 'count-1', label: 'Count 1', color: '#ff0000', count: 2 },
  ]);
  const [activeCounterSeriesId, setActiveCounterSeriesId] = useState('count-1');
  const [counterSeriesMenuOpen, setCounterSeriesMenuOpen] = useState(false);
  const [lineBorderStyle, setLineBorderStyle] = useState<keyof typeof lineBorderStyleLabels>('solid');
  const [cloudIntensity, setCloudIntensity] = useState('2');
  const [arrowheadStyle, setArrowheadStyle] = useState<keyof typeof arrowheadStyleLabels>('solidTriangle');
  const [fontSize, setFontSize] = useState('16');
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [strike, setStrike] = useState(false);
  const [alignmentIndex, setAlignmentIndex] = useState(0);
  const [openFormatDropdown, setOpenFormatDropdown] = useState<'surveyModule' | 'eraserMode' | 'lineStyle' | 'arrowhead' | 'fontSize' | null>(null);
  const strokeOnly = ['pen', 'highlighter', 'arrow', 'line'].includes(activeTool);
  const fillAndBorder = ['rect', 'ellipse', 'text', 'callout'].includes(activeTool);
  const isCounter = activeTool === 'counter';
  const supportsWidth = ['pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'text', 'callout', 'counter'].includes(activeTool) || activeTool === 'eraser';
  const supportsStyle = ['arrow', 'line', 'rect', 'ellipse', 'text', 'callout'].includes(activeTool);
  const styleOptions: LineBorderStyle[] = activeTool === 'rect' ? ['solid', 'dashed', 'dotted', 'cloud'] : ['solid', 'dashed', 'dotted'];
  const supportsText = activeTool === 'text' || activeTool === 'callout';
  const isEraserTool = activeTool === 'eraser';
  const activeCounterSeries = counterSeriesList.find((series) => series.seriesId === activeCounterSeriesId) ?? counterSeriesList[0];
  const selectedSurveyModule = surveyModules.find((module) => module.id === selectedSurveyModuleId) ?? surveyModules[0] ?? null;
  const surveyModuleOptions = surveyModules.map((module) => ({
    value: module.id,
    label: module.name || 'Untitled Module',
  }));
  const eraserModeOptions = (Object.keys(eraserModeLabels) as EraserMode[]).map((value) => ({ value, label: eraserModeLabels[value] }));
  const lineStyleOptions = styleOptions.map((value) => ({ value, label: lineBorderStyleLabels[value] }));
  const arrowheadOptions = (Object.keys(arrowheadStyleLabels) as ArrowheadStyle[]).map((value) => ({ value, label: arrowheadStyleLabels[value] }));

  useEffect(() => {
    setOpenFormatDropdown(null);
  }, [activeTool]);

  useEffect(() => {
    if (!isCounter) {
      setCounterSeriesMenuOpen(false);
    }
  }, [isCounter]);

  function setActiveCounterSeries(series: CounterSeries) {
    setActiveCounterSeriesId(series.seriesId);
    setFillColor(series.color);
    setCounterSeriesMenuOpen(false);
  }

  function createCounterSeries() {
    const index = counterSeriesList.length;
    const nextSeries = {
      seriesId: `count-${index + 1}`,
      label: `Count ${index + 1}`,
      color: counterSeriesColors[index % counterSeriesColors.length],
      count: 0,
    };
    setCounterSeriesList((current) => [...current, nextSeries]);
    setActiveCounterSeries(nextSeries);
  }

  function updateCounterFillColor(nextColor: string) {
    setFillColor(nextColor);
    if (activeCounterSeries) {
      setCounterSeriesList((current) => current.map((series) => (
        series.seriesId === activeCounterSeries.seriesId
          ? { ...series, color: nextColor }
          : series
      )));
    }
  }

  function closeFormatterMenus() {
    setCounterSeriesMenuOpen(false);
    setOpenFormatDropdown(null);
  }

  function openEditPanel(focus: AnnotationEditFocus) {
    const sections: AnnotationEditFocus[] = [];
    if (fillAndBorder || isCounter) sections.push('fill');
    if (strokeOnly || fillAndBorder || isCounter) sections.push('stroke');
    if (supportsText) sections.push('text');

    Keyboard.dismiss();
    closeFormatterMenus();
    onOpenEditPanel({
      tool: activeTool,
      focus,
      sections: sections.includes(focus) ? sections : [focus, ...sections],
      fillColor,
      strokeColor,
      fontColor,
      setFillColor: isCounter ? updateCounterFillColor : setFillColor,
      setStrokeColor,
      setFontColor,
      strokeWidthValue,
      setStrokeWidthValue,
      eraserSizeValue,
      setEraserSizeValue,
      eraserMode,
      setEraserMode,
      lineBorderStyle,
      setLineBorderStyle,
      cloudIntensity,
      setCloudIntensity,
      arrowheadStyle,
      setArrowheadStyle,
      fontSize,
      setFontSize,
      bold,
      setBold,
      italic,
      setItalic,
      underline,
      setUnderline,
      strike,
      setStrike,
      alignmentIndex,
      setAlignmentIndex,
      counterSeriesLabel: activeCounterSeries?.label,
    });
  }

  function toggleFormatDropdown(key: 'surveyModule' | 'eraserMode' | 'lineStyle' | 'arrowhead' | 'fontSize') {
    Keyboard.dismiss();
    setCounterSeriesMenuOpen(false);
    setOpenFormatDropdown((current) => (current === key ? null : key));
  }

  if (!visible) return null;

  return (
    <View style={[styles.annotationFormatLayer, { left: railWidth, top: topOffset }]} pointerEvents="box-none">
      <View style={styles.annotationFormatBar}>
        <View style={styles.annotationFormatCenter}>
          {regionToolbarActive ? (
            regionFullPageConfirmOpen ? (
              <>
                <Text numberOfLines={1} style={styles.regionConfirmText}>Make region full page?</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm full page region" style={[styles.regionFormatButton, styles.regionFormatButtonPrimary]} onPress={onRegionFullPageConfirm}>
                  <Check color="#FFFFFF" size={15} strokeWidth={2.6} />
                  <Text style={styles.regionFormatButtonTextPrimary}>Confirm</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel full page region" style={styles.regionFormatButton} onPress={onRegionFullPageCancel}>
                  <X color={colors.text} size={15} strokeWidth={2.4} />
                  <Text style={styles.regionFormatButtonText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm region edits" style={[styles.regionFormatButton, styles.regionFormatButtonPrimary]} onPress={onRegionConfirm}>
                  <Check color="#FFFFFF" size={15} strokeWidth={2.6} />
                  <Text style={styles.regionFormatButtonTextPrimary}>Confirm</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Set region to full page" style={styles.regionFormatButton} onPress={onRegionFullPage}>
                  <Square color={colors.text} size={15} strokeWidth={2.2} />
                  <Text style={styles.regionFormatButtonText}>Full Page</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel region edits" style={styles.regionFormatButton} onPress={onRegionCancel}>
                  <X color={colors.text} size={15} strokeWidth={2.4} />
                  <Text style={styles.regionFormatButtonText}>Cancel</Text>
                </Pressable>
              </>
            )
          ) : surveyToolbarActive ? (
            <>
              {selectedSurveyModule ? (
                <FormatDropdownButton
                  label={selectedSurveyModule.name || 'Untitled Module'}
                  minWidth={138}
                  open={openFormatDropdown === 'surveyModule'}
                  options={surveyModuleOptions}
                  value={selectedSurveyModule.id}
                  onToggle={() => toggleFormatDropdown('surveyModule')}
                  onSelect={(value) => {
                    onSelectSurveyModule(value);
                    setOpenFormatDropdown(null);
                  }}
                />
              ) : (
                <View style={styles.surveyModuleEmptyPill}>
                  <Text style={styles.surveyModuleEmptyText}>No modules</Text>
                </View>
              )}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: surveyKeepCategoryActive }}
                accessibilityLabel="Keep survey category active"
                style={[styles.formatKeepActiveButton, surveyKeepCategoryActive && styles.formatKeepActiveButtonActive]}
                onPress={() => setSurveyKeepCategoryActive((value) => !value)}
              >
                <View style={[styles.formatKeepActiveBox, surveyKeepCategoryActive && styles.formatKeepActiveBoxActive]}>
                  {surveyKeepCategoryActive ? <Check color="#FFFFFF" size={10} strokeWidth={3} /> : null}
                </View>
                <Text style={[styles.formatKeepActiveText, surveyKeepCategoryActive && styles.formatKeepActiveTextActive]}>Keep active</Text>
              </Pressable>
            </>
          ) : isEraserTool ? (
            <>
              <FormatDropdownButton
                label={eraserModeLabels[eraserMode]}
                minWidth={104}
                open={openFormatDropdown === 'eraserMode'}
                options={eraserModeOptions}
                value={eraserMode}
                onToggle={() => toggleFormatDropdown('eraserMode')}
                onSelect={(value) => {
                  setEraserMode(value);
                  setOpenFormatDropdown(null);
                }}
              />
              <FormatNumberInput accessibilityLabel="Eraser size" value={eraserSizeValue} onChangeText={setEraserSizeValue} onFocusInput={closeFormatterMenus} />
            </>
          ) : (
            <>
              {strokeOnly ? (
                <FormatColorSwatch
                  accessibilityLabel="Color"
                  mode="stroke"
                  strokeColor={strokeColor}
                  fillColor={strokeColor}
                  onPress={() => openEditPanel('stroke')}
                />
              ) : null}
              {isCounter ? (
                <FormatColorSwatch
                  accessibilityLabel="Counter colors"
                  mode="counter"
                  strokeColor={strokeColor}
                  fillColor={fillColor}
                  onPress={() => openEditPanel('fill')}
                />
              ) : null}
              {isCounter ? (
                <View style={styles.counterSeriesMenuAnchor}>
                  <FormatMenuButton
                    label={activeCounterSeries?.label || 'Counter Series'}
                    onPress={() => {
                      Keyboard.dismiss();
                      setOpenFormatDropdown(null);
                      setCounterSeriesMenuOpen((open) => !open);
                    }}
                    minWidth={94}
                  />
                  {counterSeriesMenuOpen ? (
                    <View style={styles.counterSeriesDropdown}>
                      <Text style={styles.counterSeriesHeader}>Counter Series</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="New count"
                        style={styles.counterSeriesRow}
                        onPress={createCounterSeries}
                      >
                        <Text style={styles.counterSeriesLabel}>+ New Count</Text>
                      </Pressable>
                      {counterSeriesList.length > 0 ? <Text style={styles.counterSeriesSubheader}>Continue Count</Text> : null}
                      {counterSeriesList.map((series) => {
                        const active = series.seriesId === activeCounterSeries?.seriesId;
                        return (
                          <Pressable
                            key={series.seriesId}
                            accessibilityRole="button"
                            accessibilityLabel={series.label}
                            accessibilityState={{ selected: active }}
                            style={[styles.counterSeriesRow, active && styles.counterSeriesRowActive]}
                            onPress={() => setActiveCounterSeries(series)}
                          >
                            <View style={[styles.counterSeriesDot, { backgroundColor: series.color }]} />
                            <Text style={styles.counterSeriesLabel}>{series.label}</Text>
                            <Text style={styles.counterSeriesCount}>{series.count}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {fillAndBorder ? (
                <FormatColorSwatch
                  accessibilityLabel="Color"
                  mode="fillBorder"
                  strokeColor={strokeColor}
                  fillColor={fillColor}
                  onPress={() => openEditPanel('fill')}
                />
              ) : null}
              {supportsWidth ? (
                <FormatNumberInput accessibilityLabel="Width" value={strokeWidthValue} onChangeText={setStrokeWidthValue} onFocusInput={closeFormatterMenus} />
              ) : null}
              {supportsStyle ? (
                <FormatDropdownButton
                  label={lineBorderStyleLabels[lineBorderStyle]}
                  minWidth={82}
                  open={openFormatDropdown === 'lineStyle'}
                  options={lineStyleOptions}
                  value={lineBorderStyle}
                  onToggle={() => toggleFormatDropdown('lineStyle')}
                  onSelect={(value) => {
                    setLineBorderStyle(value);
                    setOpenFormatDropdown(null);
                  }}
                />
              ) : null}
              {activeTool === 'rect' && lineBorderStyle === 'cloud' ? (
                <View style={styles.bumpControl}>
                  <Text style={styles.bumpLabel}>Bump</Text>
                  <FormatNumberInput accessibilityLabel="Cloud bump size" value={cloudIntensity} onChangeText={setCloudIntensity} onFocusInput={closeFormatterMenus} />
                </View>
              ) : null}
              {(activeTool === 'arrow' || activeTool === 'callout') ? (
                <FormatDropdownButton
                  label={arrowheadStyleLabels[arrowheadStyle]}
                  minWidth={124}
                  open={openFormatDropdown === 'arrowhead'}
                  options={arrowheadOptions}
                  value={arrowheadStyle}
                  onToggle={() => toggleFormatDropdown('arrowhead')}
                  onSelect={(value) => {
                    setArrowheadStyle(value);
                    setOpenFormatDropdown(null);
                  }}
                />
              ) : null}
              {supportsText ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Text formatting"
                  style={styles.formatTextModeButton}
                  onPress={() => {
                    setMode('presets');
                    closeFormatterMenus();
                    openEditPanel('text');
                  }}
                >
                  <Text style={styles.formatPillText}>Aa</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, Keyboard, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Defs, Rect, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';
import { Check, ChevronDown, Eraser, X } from 'lucide-react-native';
import type { AnnotationEditConfig, AnnotationEditFocus, LineBorderStyle, ArrowheadStyle, EraserMode, ToolId } from '../../types';
import { colors, arrowheadStyleLabels, lineBorderStyleLabels, eraserModeLabels, formatToolTitle, annotationColorChoices } from '../../constants';
import { styles } from '../../styles';
import { normalizeHexColor, hexToHsv, hsvToHex } from '../../utils/colorUtils';
import { clampValue } from '../../utils/arrayUtils';
import { TextAlignmentOption, annotationEditSectionLabel } from './FormatPrimitives';

export function AnnotationEditPanel({
  config,
  panelHeight,
  bottomInset,
  dismissRequest,
  onClose,
}: {
  config: AnnotationEditConfig;
  panelHeight: number;
  bottomInset: number;
  dismissRequest: number;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(panelHeight + bottomInset)).current;
  const openedOnceRef = useRef(false);
  const handledDismissRequestRef = useRef(dismissRequest);
  const initialTextEditTab = config.focus === 'text' ? 'text' : 'shape';
  const [activeSection, setActiveSection] = useState<AnnotationEditFocus>(config.focus);
  const [activeTextEditTab, setActiveTextEditTab] = useState<'shape' | 'text'>(initialTextEditTab);
  const [fillColor, setFillColorLocal] = useState(config.fillColor);
  const [strokeColor, setStrokeColorLocal] = useState(config.strokeColor);
  const [fontColor, setFontColorLocal] = useState(config.fontColor);
  const [strokeWidth, setStrokeWidthLocal] = useState(config.strokeWidthValue);
  const [eraserSize, setEraserSizeLocal] = useState(config.eraserSizeValue);
  const [eraserMode, setEraserModeLocal] = useState<EraserMode>(config.eraserMode);
  const [lineStyle, setLineStyleLocal] = useState<LineBorderStyle>(config.lineBorderStyle);
  const [cloudIntensity, setCloudIntensityLocal] = useState(config.cloudIntensity);
  const [arrowheadStyle, setArrowheadStyleLocal] = useState<ArrowheadStyle>(config.arrowheadStyle);
  const [fontSize, setFontSizeLocal] = useState(config.fontSize);
  const [bold, setBoldLocal] = useState(config.bold);
  const [italic, setItalicLocal] = useState(config.italic);
  const [underline, setUnderlineLocal] = useState(config.underline);
  const [strike, setStrikeLocal] = useState(config.strike);
  const [alignmentIndex, setAlignmentIndexLocal] = useState(config.alignmentIndex);
  const [openEditDropdown, setOpenEditDropdown] = useState<'lineStyle' | 'arrowhead' | null>(null);
  const [gradientPickerSection, setGradientPickerSection] = useState<AnnotationEditFocus | null>(null);
  const [gradientHexDraft, setGradientHexDraft] = useState('');
  const [gradientOpacity, setGradientOpacity] = useState(100);
  const [gradientSquareSize, setGradientSquareSize] = useState({ width: 1, height: 1 });
  const [gradientHueWidth, setGradientHueWidth] = useState(1);
  const [gradientOpacityWidth, setGradientOpacityWidth] = useState(1);
  const toolTitle = formatToolTitle[config.tool] ?? 'Annotation';
  const widthTools: ToolId[] = ['pen', 'highlighter', 'arrow', 'line', 'rect', 'ellipse', 'text', 'callout', 'counter', 'eraser'];
  const styleTools: ToolId[] = ['arrow', 'line', 'rect', 'ellipse', 'text', 'callout'];
  const supportsWidth = widthTools.includes(config.tool);
  const supportsStyle = styleTools.includes(config.tool);
  const supportsText = config.tool === 'text' || config.tool === 'callout';
  const supportsShapeTextTabs = supportsText;
  const lineStyleOptions: LineBorderStyle[] = config.tool === 'rect' ? ['solid', 'dashed', 'dotted', 'cloud'] : ['solid', 'dashed', 'dotted'];
  const arrowheadOptions = Object.keys(arrowheadStyleLabels) as ArrowheadStyle[];
  const activePanelLabel = supportsShapeTextTabs
    ? activeTextEditTab === 'text' ? 'Text' : 'Shape'
    : annotationEditSectionLabel(activeSection, config.tool);
  const pickerPanelLabel = gradientPickerSection ? annotationEditSectionLabel(gradientPickerSection, config.tool) : activePanelLabel;
  const annotationPanelHeight = useMemo(() => {
    const headerChrome = 58;
    const tabsChrome = supportsShapeTextTabs && !gradientPickerSection ? 46 : 0;
    const scrollChrome = 12 + Math.max(bottomInset, 10) + 12;
    const colorCardHeight = (hasTabs: boolean, compact = false) => (
      hasTabs ? 148 : compact ? 88 : 104
    );
    const splitControlHeight = config.tool === 'eraser' ? 112 : 82;
    const textControlsHeight = 82 + 10 + 114;
    const gradientTabsHeight = colorPickerTabsForCurrentMode()?.length ? 46 : 0;

    let contentHeight = headerChrome + tabsChrome + scrollChrome;
    if (gradientPickerSection) {
      contentHeight += gradientTabsHeight + 176 + 28 + 28 + 1 + 48 + 42 + 60;
      return Math.min(panelHeight, contentHeight);
    }

    if (supportsText && activeTextEditTab === 'shape') {
      contentHeight += colorCardHeight(true);
    } else if (supportsText && activeTextEditTab === 'text') {
      contentHeight += colorCardHeight(false, true);
    } else {
      contentHeight += colorCardHeight(config.sections.length > 1);
    }

    if ((supportsWidth || supportsStyle) && (!supportsShapeTextTabs || activeTextEditTab === 'shape')) {
      contentHeight += 10 + splitControlHeight;
    }

    if (config.tool === 'arrow' || (config.tool === 'callout' && activeTextEditTab === 'shape')) {
      contentHeight += 10 + 70;
    }

    if (supportsText && activeTextEditTab === 'text') {
      contentHeight += 10 + textControlsHeight;
    }

    return Math.min(panelHeight, contentHeight);
  }, [
    activeTextEditTab,
    bottomInset,
    config.sections.length,
    config.tool,
    gradientPickerSection,
    panelHeight,
    supportsShapeTextTabs,
    supportsStyle,
    supportsText,
    supportsWidth,
  ]);

  useEffect(() => {
    setActiveSection(config.focus);
    setActiveTextEditTab(config.focus === 'text' ? 'text' : 'shape');
    setFillColorLocal(config.fillColor);
    setStrokeColorLocal(config.strokeColor);
    setFontColorLocal(config.fontColor);
    setStrokeWidthLocal(config.strokeWidthValue);
    setEraserSizeLocal(config.eraserSizeValue);
    setEraserModeLocal(config.eraserMode);
    setLineStyleLocal(config.lineBorderStyle);
    setCloudIntensityLocal(config.cloudIntensity);
    setArrowheadStyleLocal(config.arrowheadStyle);
    setFontSizeLocal(config.fontSize);
    setBoldLocal(config.bold);
    setItalicLocal(config.italic);
    setUnderlineLocal(config.underline);
    setStrikeLocal(config.strike);
    setAlignmentIndexLocal(config.alignmentIndex);
    setOpenEditDropdown(null);
    setGradientPickerSection(null);
    setGradientHexDraft('');
    setGradientOpacity(100);
  }, [config]);

  const closeWithAnimation = () => {
    Animated.timing(slideY, {
      toValue: annotationPanelHeight + bottomInset,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) slideY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 82 || gesture.vy > 0.65) {
            closeWithAnimation();
            return;
          }
          Animated.spring(slideY, {
            toValue: 0,
            damping: 24,
            stiffness: 260,
            mass: 0.75,
            useNativeDriver: true,
          }).start();
        },
      }),
    [slideY, annotationPanelHeight, bottomInset]
  );

  useEffect(() => {
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    slideY.setValue(annotationPanelHeight + bottomInset);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideY, annotationPanelHeight, bottomInset]);

  useEffect(() => {
    if (dismissRequest === handledDismissRequestRef.current) return;
    handledDismissRequestRef.current = dismissRequest;
    Animated.timing(slideY, {
      toValue: annotationPanelHeight + bottomInset,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [dismissRequest, slideY, annotationPanelHeight, bottomInset, onClose]);

  function applyColor(section: AnnotationEditFocus, value: string) {
    if (section === 'stroke') {
      setOpenEditDropdown(null);
      setStrokeColorLocal(value);
      config.setStrokeColor(value);
      return;
    }
    if (section === 'text') {
      setOpenEditDropdown(null);
      setFontColorLocal(value);
      config.setFontColor(value);
      return;
    }
    setOpenEditDropdown(null);
    setFillColorLocal(value);
    config.setFillColor(value);
  }

  function applyStrokeWidth(value: string) {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setStrokeWidthLocal(value);
    config.setStrokeWidthValue(value);
  }

  function applyEraserSize(value: string) {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setEraserSizeLocal(value);
    config.setEraserSizeValue(value);
  }

  function applyFontSize(value: string) {
    if (value !== '' && !/^\d+$/.test(value)) return;
    setFontSizeLocal(value);
    config.setFontSize(value);
  }

  const horizontalAlignment = alignmentIndex % 3;
  const verticalAlignment = Math.floor(alignmentIndex / 3);
  const horizontalAlignmentOptions = [
    { value: 0, label: 'Left' },
    { value: 1, label: 'Center' },
    { value: 2, label: 'Right' },
  ];
  const verticalAlignmentOptions = [
    { value: 0, label: 'Top' },
    { value: 1, label: 'Center' },
    { value: 2, label: 'Bottom' },
  ];

  function applyTextAlignment(nextHorizontal: number, nextVertical: number) {
    const next = (nextVertical * 3) + nextHorizontal;
    setAlignmentIndexLocal(next);
    config.setAlignmentIndex(next);
  }

  function colorForSection(section: AnnotationEditFocus) {
    if (section === 'stroke') return strokeColor;
    if (section === 'text') return fontColor;
    return fillColor;
  }

  function openGradientPicker(section: AnnotationEditFocus) {
    setActiveSection(section);
    setOpenEditDropdown(null);
    setGradientPickerSection(section);
    setGradientHexDraft(colorForSection(section).toUpperCase());
  }

  function applyGradientHex(section: AnnotationEditFocus, value: string) {
    const normalized = normalizeHexColor(value);
    setGradientHexDraft(value.toUpperCase());
    if (!normalized) return;
    applyColor(section, normalized);
    setGradientHexDraft(normalized);
  }

  function commitGradientHex(section: AnnotationEditFocus) {
    const normalized = normalizeHexColor(gradientHexDraft);
    if (normalized) {
      applyColor(section, normalized);
      setGradientHexDraft(normalized);
      return;
    }
    setGradientHexDraft(colorForSection(section).toUpperCase());
  }

  function colorPickerTabsForCurrentMode() {
    if (supportsText && activeTextEditTab === 'shape') return ['fill', 'stroke'] as AnnotationEditFocus[];
    if (!supportsShapeTextTabs && config.sections.length > 1) return config.sections;
    return undefined;
  }

  function pickGradientSquare(section: AnnotationEditFocus, event: GestureResponderEvent) {
    const hsv = hexToHsv(colorForSection(section));
    const saturation = clampValue(event.nativeEvent.locationX / gradientSquareSize.width, 0, 1);
    const value = clampValue(1 - (event.nativeEvent.locationY / gradientSquareSize.height), 0, 1);
    const nextColor = hsvToHex(hsv.h, saturation, value);
    applyColor(section, nextColor);
    setGradientHexDraft(nextColor);
  }

  function pickGradientHue(section: AnnotationEditFocus, event: GestureResponderEvent) {
    const hsv = hexToHsv(colorForSection(section));
    const hue = clampValue(event.nativeEvent.locationX / gradientHueWidth, 0, 1) * 360;
    const nextColor = hsvToHex(hue, hsv.s, hsv.v);
    applyColor(section, nextColor);
    setGradientHexDraft(nextColor);
  }

  function pickGradientOpacity(event: GestureResponderEvent) {
    setGradientOpacity(Math.round(clampValue(event.nativeEvent.locationX / gradientOpacityWidth, 0, 1) * 100));
  }

  function renderGradientColorPicker(section: AnnotationEditFocus) {
    const sectionColor = colorForSection(section);
    const sectionLabel = annotationEditSectionLabel(section, config.tool);
    const hsv = hexToHsv(sectionColor);
    const hueColor = hsvToHex(hsv.h, 1, 1);
    const tabSections = colorPickerTabsForCurrentMode();
    const hueThumbLeft = gradientHueWidth * clampValue(hsv.h / 360, 0, 1);
    const saturationLeft = gradientSquareSize.width * clampValue(hsv.s, 0, 1);
    const valueTop = gradientSquareSize.height * (1 - clampValue(hsv.v, 0, 1));
    const opacityWidth = gradientOpacityWidth * (gradientOpacity / 100);

    return (
      <View style={styles.gradientPickerContent}>
        {tabSections && tabSections.length > 1 ? (
          <View style={styles.annotationColorTabs}>
            {tabSections.map((tabSection, index) => {
              const active = tabSection === section;
              return (
                <React.Fragment key={`gradient-${tabSection}`}>
                  {index > 0 ? <View style={styles.annotationColorTabsDivider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${annotationEditSectionLabel(tabSection, config.tool)} color`}
                    accessibilityState={{ selected: active }}
                    style={[styles.annotationColorTab, active && styles.annotationColorTabActive]}
                    onPress={() => openGradientPicker(tabSection)}
                  >
                    <View style={[styles.annotationEditTabSwatch, { backgroundColor: colorForSection(tabSection) }]} />
                    <Text style={[styles.annotationColorTabText, active && styles.annotationColorTabTextActive]}>
                      {annotationEditSectionLabel(tabSection, config.tool)}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={`${sectionLabel} saturation and brightness`}
          onLayout={(event) => setGradientSquareSize(event.nativeEvent.layout)}
          onPress={(event) => pickGradientSquare(section, event)}
          style={styles.gradientPickerSquare}
        >
          <Svg width="100%" height="100%" viewBox="0 0 320 176" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
            <Defs>
              <SvgLinearGradient id={`sat-${section}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" />
                <Stop offset="1" stopColor={hueColor} />
              </SvgLinearGradient>
              <SvgLinearGradient id={`val-${section}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000000" stopOpacity="1" />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="320" height="176" fill={`url(#sat-${section})`} />
            <Rect x="0" y="0" width="320" height="176" fill={`url(#val-${section})`} />
          </Svg>
          <View style={[styles.gradientPickerThumb, { left: saturationLeft, top: valueTop }]} />
        </Pressable>

        <View style={styles.gradientPickerRow}>
          <Text style={styles.gradientPickerLabel}>HUE</Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`${sectionLabel} hue`}
            onLayout={(event) => setGradientHueWidth(event.nativeEvent.layout.width)}
            onPress={(event) => pickGradientHue(section, event)}
            style={styles.gradientHueTrack}
          >
            <Svg width="100%" height="100%" viewBox="0 0 320 16" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinearGradient id={`hue-${section}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#FF0000" />
                  <Stop offset="0.17" stopColor="#FFFF00" />
                  <Stop offset="0.33" stopColor="#00FF00" />
                  <Stop offset="0.5" stopColor="#00FFFF" />
                  <Stop offset="0.67" stopColor="#0000FF" />
                  <Stop offset="0.83" stopColor="#FF00FF" />
                  <Stop offset="1" stopColor="#FF0000" />
                </SvgLinearGradient>
              </Defs>
              <Rect x="0" y="0" width="320" height="16" rx="8" fill={`url(#hue-${section})`} />
            </Svg>
            <View style={[styles.gradientHueThumb, { left: hueThumbLeft }]} />
          </Pressable>
          <Text style={styles.gradientPickerValue}>{Math.round(hsv.h)}°</Text>
        </View>

        <View style={styles.gradientPickerRow}>
          <Text style={styles.gradientPickerLabel}>OPACITY</Text>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`${sectionLabel} opacity`}
            onLayout={(event) => setGradientOpacityWidth(event.nativeEvent.layout.width)}
            onPress={pickGradientOpacity}
            style={styles.gradientOpacityTrack}
          >
            <View style={[styles.gradientOpacityFill, { width: opacityWidth }]} />
            <View style={[styles.gradientOpacityThumb, { left: opacityWidth }]} />
          </Pressable>
          <Text style={styles.gradientPickerValue}>{gradientOpacity}%</Text>
        </View>

        <View style={styles.gradientPickerDivider} />

        <View style={styles.gradientPickerInputRow}>
          <View style={[styles.gradientPickerPreview, { backgroundColor: sectionColor }]} />
          <TextInput
            accessibilityLabel={`${sectionLabel} hex color`}
            autoCapitalize="characters"
            autoCorrect={false}
            value={gradientHexDraft || sectionColor.toUpperCase()}
            onChangeText={(value) => applyGradientHex(section, value)}
            onBlur={() => commitGradientHex(section)}
            style={styles.gradientPickerHexInput}
          />
          <View style={styles.gradientPickerOpacityInput}>
            <TextInput
              accessibilityLabel={`${sectionLabel} opacity percent`}
              keyboardType="number-pad"
              value={String(gradientOpacity)}
              onChangeText={(value) => {
                if (value !== '' && !/^\d+$/.test(value)) return;
                setGradientOpacity(value === '' ? 100 : clampValue(Number(value), 0, 100));
              }}
              style={styles.gradientPickerOpacityTextInput}
            />
            <Text style={styles.gradientPickerPercentText}>%</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to annotation settings"
          style={styles.gradientPickerDoneButton}
          onPress={() => {
            Keyboard.dismiss();
            setGradientPickerSection(null);
            setGradientHexDraft('');
          }}
        >
          <Text style={styles.gradientPickerDoneText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  function renderColorCard(section: AnnotationEditFocus, compact = false, tabSections?: AnnotationEditFocus[]) {
    const sectionColor = colorForSection(section);
    const sectionLabel = annotationEditSectionLabel(section, config.tool);

    return (
      <View style={[styles.annotationEditCard, compact && styles.annotationEditCardCompact]} key={`${section}-color-card`}>
        {tabSections && tabSections.length > 1 ? (
          <View style={styles.annotationColorTabs}>
            {tabSections.map((tabSection, index) => {
              const active = tabSection === section;
              return (
                <React.Fragment key={tabSection}>
                  {index > 0 ? <View style={styles.annotationColorTabsDivider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${annotationEditSectionLabel(tabSection, config.tool)} color`}
                    accessibilityState={{ selected: active }}
                    style={[styles.annotationColorTab, active && styles.annotationColorTabActive]}
                    onPress={() => {
                      setActiveSection(tabSection);
                      setOpenEditDropdown(null);
                    }}
                  >
                    <View style={[styles.annotationEditTabSwatch, { backgroundColor: colorForSection(tabSection) }]} />
                    <Text style={[styles.annotationColorTabText, active && styles.annotationColorTabTextActive]}>
                      {annotationEditSectionLabel(tabSection, config.tool)}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        ) : null}
        <View style={styles.annotationEditCardHeader}>
          <View>
            <Text style={styles.annotationEditLabel}>{sectionLabel} color</Text>
            <Text style={styles.annotationEditValue}>{sectionColor.toUpperCase()}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${sectionLabel} color picker`}
            hitSlop={8}
            style={styles.annotationEditSwatchButton}
            onPress={() => openGradientPicker(section)}
          >
            <View
              style={[
                styles.annotationEditLargeSwatch,
                compact && styles.annotationEditCompactSwatch,
                { backgroundColor: sectionColor, borderColor: section === 'fill' ? strokeColor : '#454B56' },
              ]}
            />
          </Pressable>
        </View>
        <View style={styles.annotationColorGrid}>
          {annotationColorChoices.map((color) => {
            const active = color.toLowerCase() === sectionColor.toLowerCase();
            return (
              <Pressable
                key={`${section}-${color}`}
                accessibilityRole="button"
                accessibilityLabel={`Set ${sectionLabel} color ${color}`}
                accessibilityState={{ selected: active }}
                hitSlop={4}
                style={[styles.annotationColorChoice, active && styles.annotationColorChoiceActive]}
                onPress={() => applyColor(section, color)}
              >
                <View style={[styles.annotationColorDot, { backgroundColor: color }]} />
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.annotationEditSheet,
        { height: annotationPanelHeight, transform: [{ translateY: slideY }] },
      ]}
    >
      <View {...panResponder.panHandlers}>
        <View style={styles.hubGrabber} />
        <View style={styles.drawerHeader}>
          <View>
            <Text style={styles.drawerTitle}>{gradientPickerSection ? `${pickerPanelLabel} color` : `${toolTitle} settings`}</Text>
            <Text style={styles.drawerSubtitle}>{gradientPickerSection ? 'Gradient picker' : `Focused on ${activePanelLabel}`}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close annotation settings" onPress={closeWithAnimation}>
            <X color={colors.text} size={18} />
          </Pressable>
        </View>
      </View>

      {supportsShapeTextTabs && !gradientPickerSection ? (
        <View style={styles.annotationEditTabs}>
          <View style={styles.annotationEditSegmentedTabs}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Shape settings"
              accessibilityState={{ selected: activeTextEditTab === 'shape' }}
              style={[styles.annotationEditSegmentedTab, activeTextEditTab === 'shape' && styles.annotationEditSegmentedTabActive]}
              onPress={() => {
                setActiveTextEditTab('shape');
                setOpenEditDropdown(null);
              }}
            >
              <Text style={[styles.annotationEditTabText, activeTextEditTab === 'shape' && styles.annotationEditTabTextActive]}>
                Shape
              </Text>
            </Pressable>
            <View style={styles.annotationEditSegmentedDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Text settings"
              accessibilityState={{ selected: activeTextEditTab === 'text' }}
              style={[styles.annotationEditSegmentedTab, activeTextEditTab === 'text' && styles.annotationEditSegmentedTabActive]}
              onPress={() => {
                setActiveTextEditTab('text');
                setOpenEditDropdown(null);
              }}
            >
              <Text style={[styles.annotationEditTabText, activeTextEditTab === 'text' && styles.annotationEditTabTextActive]}>
                Text
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.annotationEditScroll}
        contentContainerStyle={[styles.annotationEditContent, { paddingBottom: Math.max(bottomInset, 10) + 6 }]}
        showsVerticalScrollIndicator={false}
      >
        {gradientPickerSection ? renderGradientColorPicker(gradientPickerSection) : (
          <>
            {supportsText && activeTextEditTab === 'shape' ? (
              renderColorCard(activeSection === 'stroke' ? 'stroke' : 'fill', false, ['fill', 'stroke'])
            ) : null}

            {supportsText && activeTextEditTab === 'text' ? renderColorCard('text', true) : null}

            {!supportsShapeTextTabs ? renderColorCard(activeSection, false, config.sections.length > 1 ? config.sections : undefined) : null}
          </>
        )}

        {!gradientPickerSection && (supportsWidth || supportsStyle) && (!supportsShapeTextTabs || activeTextEditTab === 'shape') ? (
          <View style={[styles.annotationEditCard, styles.annotationSplitControlCard]}>
            {supportsStyle ? (
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>Stroke style</Text>
                <View style={[styles.annotationDropdownWrap, styles.annotationDropdownFullWidth]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Stroke style"
                    accessibilityState={{ expanded: openEditDropdown === 'lineStyle' }}
                    style={styles.annotationDropdownField}
                    onPress={() => setOpenEditDropdown(openEditDropdown === 'lineStyle' ? null : 'lineStyle')}
                  >
                    <Text style={styles.annotationDropdownValue}>{lineBorderStyleLabels[lineStyle]}</Text>
                    <ChevronDown color={colors.muted} size={15} />
                  </Pressable>
                  {openEditDropdown === 'lineStyle' ? (
                    <View style={styles.annotationDropdownMenuPopover}>
                      <ScrollView style={styles.annotationDropdownMenuScroll} showsVerticalScrollIndicator={lineStyleOptions.length > 4}>
                        {lineStyleOptions.map((style) => {
                          const active = style === lineStyle;
                          return (
                            <Pressable
                              key={style}
                              accessibilityRole="button"
                              accessibilityLabel={lineBorderStyleLabels[style]}
                              accessibilityState={{ selected: active }}
                              style={[styles.annotationDropdownItem, active && styles.annotationDropdownItemActive]}
                              onPress={() => {
                                setLineStyleLocal(style);
                                config.setLineBorderStyle(style);
                                setOpenEditDropdown(null);
                              }}
                            >
                              <Text style={[styles.annotationDropdownItemText, active && styles.annotationDropdownItemTextActive]}>{lineBorderStyleLabels[style]}</Text>
                              {active ? <Check color={colors.blue} size={15} strokeWidth={2.4} /> : null}
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
                {config.tool === 'rect' && lineStyle === 'cloud' ? (
                  <View style={[styles.annotationEditRowTight, styles.annotationDropdownFullWidth]}>
                    <Text style={styles.annotationEditValue}>Cloud bump</Text>
                    <TextInput
                      accessibilityLabel="Cloud bump size"
                      keyboardType="number-pad"
                      value={cloudIntensity}
                      onChangeText={(value) => {
                        if (value !== '' && !/^\d+$/.test(value)) return;
                        setCloudIntensityLocal(value);
                        config.setCloudIntensity(value);
                      }}
                      style={styles.annotationEditNumberInput}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {supportsWidth && supportsStyle ? <View style={styles.annotationSplitControlDivider} /> : null}

            {supportsWidth ? (
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>{config.tool === 'eraser' ? 'Eraser size' : 'Stroke width'}</Text>
                <TextInput
                  accessibilityLabel={config.tool === 'eraser' ? 'Eraser size' : 'Stroke width'}
                  keyboardType="number-pad"
                  value={config.tool === 'eraser' ? eraserSize : strokeWidth}
                  onChangeText={config.tool === 'eraser' ? applyEraserSize : applyStrokeWidth}
                  style={styles.annotationEditNumberInput}
                />
                {config.tool === 'eraser' ? (
                  <View style={styles.annotationChipRow}>
                    {(Object.keys(eraserModeLabels) as EraserMode[]).map((mode) => {
                      const active = mode === eraserMode;
                      return (
                        <Pressable
                          key={mode}
                          accessibilityRole="button"
                          accessibilityLabel={eraserModeLabels[mode]}
                          accessibilityState={{ selected: active }}
                          style={[styles.annotationChip, active && styles.annotationChipActive]}
                          onPress={() => {
                            setEraserModeLocal(mode);
                            config.setEraserMode(mode);
                          }}
                        >
                          <Text style={[styles.annotationChipText, active && styles.annotationChipTextActive]}>{eraserModeLabels[mode]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {!gradientPickerSection && (config.tool === 'arrow' || (config.tool === 'callout' && activeTextEditTab === 'shape')) ? (
          <View style={styles.annotationEditCard}>
            <Text style={styles.annotationEditLabel}>Arrowhead</Text>
            <View style={styles.annotationDropdownWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Arrowhead"
                accessibilityState={{ expanded: openEditDropdown === 'arrowhead' }}
                style={styles.annotationDropdownField}
                onPress={() => setOpenEditDropdown(openEditDropdown === 'arrowhead' ? null : 'arrowhead')}
              >
                <Text style={styles.annotationDropdownValue}>{arrowheadStyleLabels[arrowheadStyle]}</Text>
                <ChevronDown color={colors.muted} size={15} />
              </Pressable>
              {openEditDropdown === 'arrowhead' ? (
                <View style={styles.annotationDropdownMenuPopover}>
                  <ScrollView style={styles.annotationDropdownMenuScroll} showsVerticalScrollIndicator={arrowheadOptions.length > 4}>
                    {arrowheadOptions.map((style) => {
                      const active = style === arrowheadStyle;
                      return (
                        <Pressable
                          key={style}
                          accessibilityRole="button"
                          accessibilityLabel={arrowheadStyleLabels[style]}
                          accessibilityState={{ selected: active }}
                          style={[styles.annotationDropdownItem, active && styles.annotationDropdownItemActive]}
                          onPress={() => {
                            setArrowheadStyleLocal(style);
                            config.setArrowheadStyle(style);
                            setOpenEditDropdown(null);
                          }}
                        >
                          <Text style={[styles.annotationDropdownItemText, active && styles.annotationDropdownItemTextActive]}>{arrowheadStyleLabels[style]}</Text>
                          {active ? <Check color={colors.blue} size={15} strokeWidth={2.4} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {!gradientPickerSection && supportsText && activeTextEditTab === 'text' ? (
          <>
            <View style={[styles.annotationEditCard, styles.annotationSplitControlCard]}>
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>Text formatting</Text>
                <View style={styles.annotationFormatToggleRow}>
                  {[
                    { key: 'bold', label: 'B', active: bold, setLocal: setBoldLocal, setRemote: config.setBold, textStyle: styles.boldFormatText },
                    { key: 'italic', label: 'I', active: italic, setLocal: setItalicLocal, setRemote: config.setItalic, textStyle: styles.italicFormatText },
                    { key: 'underline', label: 'U', active: underline, setLocal: setUnderlineLocal, setRemote: config.setUnderline, textStyle: styles.underlineFormatText },
                    { key: 'strike', label: 'S', active: strike, setLocal: setStrikeLocal, setRemote: config.setStrike, textStyle: styles.strikeFormatText },
                  ].map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={item.key}
                      accessibilityState={{ selected: item.active }}
                      style={[styles.annotationFormatToggle, item.active && styles.annotationChipActive]}
                      onPress={() => {
                        item.setLocal((active) => !active);
                        item.setRemote((active) => !active);
                      }}
                    >
                      <Text style={[styles.desktopFormatButtonText, item.active && styles.desktopFormatButtonTextActive, item.textStyle]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.annotationSplitControlDivider} />
              <View style={styles.annotationSplitControlPane}>
                <Text style={styles.annotationEditLabel}>Text size</Text>
                <TextInput
                  accessibilityLabel="Font size"
                  keyboardType="number-pad"
                  value={fontSize}
                  onChangeText={applyFontSize}
                  style={styles.annotationEditNumberInput}
                />
              </View>
            </View>

            <View style={styles.annotationEditCard}>
              <Text style={styles.annotationEditLabel}>Text alignment</Text>
              <View style={styles.annotationAlignmentGroup}>
                <View style={styles.annotationAlignmentChoiceRow}>
                  {horizontalAlignmentOptions.map((option) => (
                    <TextAlignmentOption
                      key={option.label}
                      axis="horizontal"
                      value={option.value}
                      label={option.label}
                      active={horizontalAlignment === option.value}
                      onPress={() => applyTextAlignment(option.value, verticalAlignment)}
                    />
                  ))}
                </View>
              </View>
              <View style={styles.annotationAlignmentGroup}>
                <View style={styles.annotationAlignmentChoiceRow}>
                  {verticalAlignmentOptions.map((option) => (
                    <TextAlignmentOption
                      key={option.label}
                      axis="vertical"
                      value={option.value}
                      label={option.label}
                      active={verticalAlignment === option.value}
                      onPress={() => applyTextAlignment(horizontalAlignment, option.value)}
                    />
                  ))}
                </View>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}



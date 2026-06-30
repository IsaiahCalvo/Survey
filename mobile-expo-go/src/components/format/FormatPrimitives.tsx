import React, { useEffect, useRef } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { G, Line, Path, Rect } from 'react-native-svg';
import { Check, ChevronDown } from 'lucide-react-native';
import type { AnnotationEditFocus, ToolId, LineBorderStyle, ArrowheadStyle } from '../../types';
import { colors, arrowheadStyleLabels } from '../../constants';
import { styles } from '../../styles';

export function FormatColorSwatch({
  mode,
  strokeColor,
  fillColor,
  accessibilityLabel,
  onPress,
}: {
  mode: 'stroke' | 'fillBorder' | 'counter';
  strokeColor: string;
  fillColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.contextColorSwatch,
        mode === 'fillBorder' && { borderWidth: 2, borderColor: strokeColor },
      ]}
      onPress={onPress}
    >
      <View style={styles.checkerCellOne} />
      <View style={styles.checkerCellTwo} />
      <View style={[styles.contextColorFill, { backgroundColor: fillColor }]} />
      {mode === 'counter' ? <Text style={[styles.counterSwatchText, { color: strokeColor }]}>1</Text> : null}
    </Pressable>
  );
}

export function FormatNumberInput({
  value,
  onChangeText,
  accessibilityLabel,
  onFocusInput,
}: {
  value: string;
  onChangeText: (value: string) => void;
  accessibilityLabel: string;
  onFocusInput?: () => void;
}) {
  const fallbackValueRef = useRef(value || '0');
  const draftValueRef = useRef(value);

  useEffect(() => {
    draftValueRef.current = value;
    if (value !== '') fallbackValueRef.current = value;
  }, [value]);

  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      keyboardType="number-pad"
      value={value}
      selectTextOnFocus
      returnKeyType="done"
      onFocus={() => {
        onFocusInput?.();
        fallbackValueRef.current = value || fallbackValueRef.current;
        draftValueRef.current = value;
      }}
      onChangeText={(next) => {
        if (next === '' || /^\d+$/.test(next)) {
          draftValueRef.current = next;
          onChangeText(next);
        }
      }}
      onBlur={() => {
        if (draftValueRef.current === '') {
          onChangeText(fallbackValueRef.current);
        } else {
          fallbackValueRef.current = draftValueRef.current;
        }
      }}
      onSubmitEditing={() => Keyboard.dismiss()}
      style={styles.desktopNumberInput}
    />
  );
}

export function FormatMenuButton({ label, onPress, minWidth }: { label: string; onPress: () => void; minWidth: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.desktopMenuButton, { minWidth }]} onPress={onPress}>
      <Text style={styles.desktopMenuButtonText} numberOfLines={1}>{label}</Text>
      <ChevronDown color="#aaa" size={10} strokeWidth={2.4} />
    </Pressable>
  );
}

export function FormatDropdownButton<T extends string>({
  label,
  minWidth,
  open,
  options,
  value,
  onToggle,
  onSelect,
}: {
  label: string;
  minWidth: number;
  open: boolean;
  options: Array<{ value: T; label: string }>;
  value: T;
  onToggle: () => void;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={[styles.formatDropdownAnchor, { width: minWidth }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        style={[styles.desktopMenuButton, { width: minWidth }]}
        onPress={onToggle}
      >
        <Text style={styles.desktopMenuButtonText} numberOfLines={1}>{label}</Text>
        <ChevronDown color="#aaa" size={10} strokeWidth={2.4} />
      </Pressable>
      {open ? (
        <View style={[styles.formatDropdownMenu, { width: minWidth }]}>
          <ScrollView style={styles.formatDropdownScroll} showsVerticalScrollIndicator={options.length > 4}>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: active }}
                  style={[styles.formatDropdownRow, active && styles.formatDropdownRowActive]}
                  onPress={() => onSelect(option.value)}
                >
                  <Text style={[styles.formatDropdownText, active && styles.formatDropdownTextActive]} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {active ? <Check color={colors.blue} size={13} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export function TextAlignmentOption({
  axis,
  value,
  label,
  active,
  onPress,
}: {
  axis: 'horizontal' | 'vertical';
  value: number;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${axis} alignment`}
      accessibilityState={{ selected: active }}
      style={[styles.annotationAlignmentChoice, active && styles.annotationAlignmentChoiceActive]}
      onPress={onPress}
    >
      <TextAlignmentSvg axis={axis} value={value} active={active} />
    </Pressable>
  );
}

export function TextAlignmentSvg({
  axis,
  value,
  active,
}: {
  axis: 'horizontal' | 'vertical';
  value: number;
  active: boolean;
}) {
  const blue = '#35BEEA';
  const softBlue = '#A7E1F4';
  const stroke = active ? '#F4F7FB' : '#D8DEE9';
  const strokeWidth = 6;
  const commonProps = {
    stroke,
    strokeWidth,
    strokeLinecap: 'round' as const,
  };

  if (axis === 'horizontal') {
    const content = (
      <>
        <Line x1={48} y1={44} x2={48} y2={212} {...commonProps} />
        <Rect x={70} y={62} width={150} height={34} rx={8} fill={blue} />
        <Rect x={70} y={111} width={76} height={34} rx={8} fill={softBlue} />
        <Rect x={70} y={160} width={116} height={34} rx={8} fill={blue} />
      </>
    );

    return (
      <Svg width={48} height={34} viewBox="0 0 256 256">
        {value === 0 ? content : null}
        {value === 1 ? (
          <>
            <Line x1={128} y1={44} x2={128} y2={212} {...commonProps} />
            <Rect x={53} y={62} width={150} height={34} rx={8} fill={blue} />
            <Rect x={91} y={111} width={74} height={34} rx={8} fill={softBlue} />
            <Rect x={72} y={160} width={112} height={34} rx={8} fill={blue} />
          </>
        ) : null}
        {value === 2 ? <G transform="translate(256 0) scale(-1 1)">{content}</G> : null}
      </Svg>
    );
  }

  return (
    <Svg width={48} height={34} viewBox="0 0 256 256">
      {value === 0 ? (
        <>
          <Rect x={53} y={66} width={150} height={34} rx={8} fill={blue} />
          <Line x1={128} y1={130} x2={128} y2={202} {...commonProps} />
          <Path d="M128 130 L105 153 M128 130 L151 153" fill="none" {...commonProps} strokeLinejoin="round" />
        </>
      ) : null}
      {value === 1 ? (
        <>
          <Rect x={53} y={111} width={150} height={34} rx={8} fill={blue} />
          <Line x1={128} y1={40} x2={128} y2={82} {...commonProps} />
          <Path d="M128 82 L105 59 M128 82 L151 59" fill="none" {...commonProps} strokeLinejoin="round" />
          <Line x1={128} y1={174} x2={128} y2={216} {...commonProps} />
          <Path d="M128 174 L105 197 M128 174 L151 197" fill="none" {...commonProps} strokeLinejoin="round" />
        </>
      ) : null}
      {value === 2 ? (
        <>
          <Line x1={128} y1={48} x2={128} y2={120} {...commonProps} />
          <Path d="M128 120 L105 97 M128 120 L151 97" fill="none" {...commonProps} strokeLinejoin="round" />
          <Rect x={53} y={156} width={150} height={34} rx={8} fill={blue} />
        </>
      ) : null}
    </Svg>
  );
}

export function annotationEditSectionLabel(section: AnnotationEditFocus, tool: ToolId) {
  if (tool === 'counter' && section === 'fill') return 'Pin Fill';
  if (tool === 'counter' && section === 'stroke') return 'Pin Number';
  if (section === 'text') return 'Text';
  if (section === 'fill') return 'Fill';
  return 'Stroke';
}

// Re-export arrowheadStyleLabels so AnnotationEditPanel can import from here
export { arrowheadStyleLabels };

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDown, ChevronLeft, ChevronRight, FileText, X } from 'lucide-react-native';
import type { SurveyModule, SurveyTemplate } from '@survey/shared';
import type { Marker } from '../../types';
import { colors } from '../../constants';
import { entities } from '../../data/surveyData';
import { styles } from '../../styles';

export function SurveySetupSheet({
  template,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  modules,
  moduleIndex,
  selectedCategoryId,
  markers,
  sheetHeight,
  bottomInset,
  onSelectModule,
  onSelectMarker,
  onPlaceCategory,
  onExitSurvey,
  onClose,
}: {
  template: SurveyTemplate | null;
  templates: SurveyTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string) => void;
  modules: SurveyModule[];
  moduleIndex: number;
  selectedCategoryId: string | null;
  markers: Marker[];
  sheetHeight: number;
  bottomInset: number;
  onSelectModule: (moduleId: string) => void;
  onSelectMarker: (markerId: number) => void;
  onPlaceCategory: (moduleId: string, categoryId: string) => void;
  onExitSurvey: () => void;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(sheetHeight + bottomInset)).current;
  const openedOnceRef = useRef(false);
  const [openDropdown, setOpenDropdown] = useState<'template' | 'module' | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(selectedCategoryId);
  const activeModule = modules[moduleIndex] ?? modules[0];
  const canGoBack = moduleIndex > 0;
  const canGoForward = moduleIndex < modules.length - 1;

  const closeWithAnimation = () => {
    Animated.timing(slideY, {
      toValue: sheetHeight + bottomInset,
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
    [slideY, sheetHeight, bottomInset]
  );

  useEffect(() => {
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    slideY.setValue(sheetHeight + bottomInset);
    Animated.timing(slideY, {
      toValue: 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideY, sheetHeight, bottomInset]);

  const selectModuleIndex = (nextIndex: number) => {
    const nextModule = modules[nextIndex];
    if (!nextModule) return;
    onSelectModule(nextModule.id);
    setExpandedCategoryId(null);
    setOpenDropdown(null);
  };

  const toggleCategoryItems = (categoryId: string) => {
    if (!activeModule) return;
    setExpandedCategoryId((current) => (current === categoryId ? null : categoryId));
  };

  const placeCategoryMarker = (categoryId: string) => {
    if (!activeModule) return;
    onPlaceCategory(activeModule.id, categoryId);
  };

  return (
    <Animated.View style={[styles.sheet, { height: sheetHeight, paddingBottom: bottomInset + 10, transform: [{ translateY: slideY }] }]}>
      <View style={styles.sheetFixedTop} {...panResponder.panHandlers}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleColumn}>
            <Text style={styles.sheetEyebrow}>Survey template</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose survey template"
              style={styles.templateTitleButton}
              onPress={() => setOpenDropdown(openDropdown === 'template' ? null : 'template')}
            >
              <Text numberOfLines={1} style={styles.sheetTitle}>{template?.name ?? 'Choose survey template'}</Text>
              <ChevronDown color={colors.muted} size={14} />
            </Pressable>
            {openDropdown === 'template' ? (
              <View style={styles.templateDropdownMenu}>
                {templates.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.dropdownItem, item.id === selectedTemplateId && styles.dropdownItemActive]}
                    onPress={() => {
                      onSelectTemplate(item.id);
                      setOpenDropdown(null);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close survey setup" style={styles.exportButton} onPress={closeWithAnimation}>
            <X color={colors.text} size={18} />
          </Pressable>
        </View>

        {template ? (
          <View style={styles.sheetRow}>
            <View style={styles.moduleNavigator}>
              <Pressable disabled={!canGoBack} style={[styles.moduleArrow, !canGoBack && styles.moduleArrowDisabled]} onPress={() => selectModuleIndex(moduleIndex - 1)}>
                <ChevronLeft color={canGoBack ? colors.text : colors.faint} size={18} />
              </Pressable>
              <View style={styles.moduleDropdownWrap}>
                <Pressable style={styles.moduleCenter} onPress={() => setOpenDropdown(openDropdown === 'module' ? null : 'module')}>
                  <Text style={styles.moduleCenterText}>{activeModule?.name ?? 'Select module'}</Text>
                  <ChevronDown color={colors.muted} size={14} />
                </Pressable>
                {openDropdown === 'module' ? (
                  <View style={styles.dropdownMenu}>
                    {modules.map((module, index) => (
                      <Pressable
                        key={module.id}
                        style={[styles.dropdownItem, module.id === activeModule?.id && styles.dropdownItemActive]}
                        onPress={() => selectModuleIndex(index)}
                      >
                        <Text style={styles.dropdownItemText}>{module.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
              <Pressable disabled={!canGoForward} style={[styles.moduleArrow, !canGoForward && styles.moduleArrowDisabled]} onPress={() => selectModuleIndex(moduleIndex + 1)}>
                <ChevronRight color={canGoForward ? colors.text : colors.faint} size={18} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {template ? (
        <>
          <View style={styles.surveyCategoryHeader}>
            <Text style={styles.compactFieldLabel}>Select Category to Highlight</Text>
            <Text style={styles.assignedText}>Tap category to place marker</Text>
          </View>

          <ScrollView style={styles.surveyCategoryList} contentContainerStyle={styles.surveyCategoryListContent} showsVerticalScrollIndicator>
            {(activeModule?.categories ?? []).map((category) => {
              const categoryMarkers = activeModule ? markers.filter((marker) => marker.moduleId === activeModule.id && marker.categoryId === category.id) : [];
              const count = categoryMarkers.length;
              const active = selectedCategoryId === category.id;
              const expanded = expandedCategoryId === category.id;
              return (
                <View key={category.id} style={[styles.surveyCategoryCard, active && styles.surveyCategoryCardActive]}>
                  <View style={styles.surveyCategoryRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Place ${category.name} survey marker`}
                      style={styles.surveyCategoryMain}
                      onPress={() => placeCategoryMarker(category.id)}
                    >
                      <Text numberOfLines={1} style={[styles.surveyCategoryName, active && styles.surveyCategoryNameActive]}>{category.name}</Text>
                      <Text style={[styles.surveyCategoryCount, active && styles.surveyCategoryNameActive]}>{count}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={expanded ? `Collapse ${category.name}` : `Expand ${category.name}`}
                      style={styles.surveyCategoryExpand}
                      onPress={() => toggleCategoryItems(category.id)}
                    >
                      <ChevronDown color={active || expanded ? colors.blue : colors.text} size={16} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
                    </Pressable>
                  </View>
                  {expanded ? (
                    <View style={styles.surveyCategoryItems}>
                      {categoryMarkers.length ? categoryMarkers.map((categoryItem) => {
                        const entity = (template?.entities ?? entities).find((entry) => entry.id === categoryItem.entity);
                        return (
                          <Pressable
                            key={categoryItem.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Open category item ${categoryItem.name}`}
                            style={styles.surveyCategoryItemRow}
                            onPress={() => onSelectMarker(categoryItem.id)}
                          >
                            <View style={[styles.entityDot, { backgroundColor: entity?.color ?? colors.faint }]} />
                            <Text numberOfLines={1} style={styles.surveyCategoryItemName}>{categoryItem.name}</Text>
                          </Pressable>
                        );
                      }) : (
                        <View style={styles.surveyCategoryEmptyItems}>
                          <Text style={styles.surveyCategoryEmptyText}>No category items yet. Hide panel, then tap plan to add one.</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </>
      ) : (
        <View style={styles.templatePickerBody}>
          <Text style={styles.compactFieldLabel}>Available Templates</Text>
          <View style={styles.templatePickerList}>
            {templates.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Select survey template ${item.name}`}
                style={styles.templatePickerItem}
                onPress={() => {
                  onSelectTemplate(item.id);
                  setOpenDropdown(null);
                }}
              >
                <View style={styles.templatePickerIcon}>
                  <FileText color={colors.blue} size={16} />
                </View>
                <View style={styles.templatePickerCopy}>
                  <Text numberOfLines={1} style={styles.templatePickerTitle}>{item.name}</Text>
                  <Text style={styles.templatePickerMeta}>{item.modules.length} modules</Text>
                </View>
                <ChevronRight color={colors.muted} size={16} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.sheetFooter}>
        <Pressable accessibilityRole="button" accessibilityLabel="Exit survey mode" style={styles.exitSurveyButton} onPress={onExitSurvey}>
          <Text style={styles.exitSurveyText}>Exit Survey</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}


import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ChevronDown, ChevronLeft, ChevronRight, ImageIcon, PenLine, Search, Video, X } from 'lucide-react-native';
import type { ChecklistSelection, Entity, SurveyCategory, SurveyChecklistItem, SurveyModule, SurveyTemplate } from '@survey/shared';
import type { Marker } from '../../types';
import { colors, ExportIcon } from '../../constants';
import { entities } from '../../data/surveyData';
import { MAX_VISIBLE_CHECKLIST_ITEMS } from '../../utils/pageUtils';
import { styles } from '../../styles';

export function SurveySheet({
  marker,
  markers,
  entityName,
  template,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  modules,
  entities,
  moduleIndex,
  activeCategory,
  checklistItems,
  lastCategoryByModule,
  rememberSurveySelection,
  updateMarker,
  sheetHeight,
  checklistWindowHeight,
  bottomInset,
  onSelectMarker,
  onLocateMarker,
  onExitSurvey,
  onClose,
}: {
  marker: Marker;
  markers: Marker[];
  entityName: string;
  template: SurveyTemplate | null;
  templates: SurveyTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string) => void;
  modules: SurveyModule[];
  entities: Entity[];
  moduleIndex: number;
  activeCategory: SurveyCategory | null;
  checklistItems: SurveyChecklistItem[];
  lastCategoryByModule: Record<string, string>;
  rememberSurveySelection: (moduleId: string, categoryId: string | null) => void;
  updateMarker: (markerId: number, patch: Partial<Marker>) => void;
  sheetHeight: number;
  checklistWindowHeight: number;
  bottomInset: number;
  onSelectMarker: (markerId: number) => void;
  onLocateMarker: (marker: Marker) => void;
  onExitSurvey: () => void;
  onClose: () => void;
}) {
  const slideY = useRef(new Animated.Value(sheetHeight + bottomInset)).current;
  const openedOnceRef = useRef(false);
  const [openDropdown, setOpenDropdown] = useState<'template' | 'module' | 'category' | 'entity' | 'markerItem' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [notesEditorOpen, setNotesEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(marker.notes ?? '');
  const [photoDrafts, setPhotoDrafts] = useState<string[]>(marker.photos ?? []);
  const [videoDrafts, setVideoDrafts] = useState<string[]>(marker.videos ?? []);
  const activeModule = modules[moduleIndex] ?? modules[0];
  const activeEntity = entities.find((entity) => entity.id === marker.entity) ?? null;
  const categoryItems = activeModule && activeCategory
    ? markers.filter((item) => item.moduleId === activeModule.id && item.categoryId === activeCategory.id)
    : [];
  const canGoBack = moduleIndex > 0;
  const canGoForward = moduleIndex < modules.length - 1;

  const selectedTemplateName = template?.name ?? 'Choose survey template';

  const selectModule = (nextIndex: number) => {
    const nextModule = modules[nextIndex];
    if (!nextModule) return;
    const categoryId = nextModule.categories.some((category) => category.id === lastCategoryByModule[nextModule.id])
      ? lastCategoryByModule[nextModule.id]
      : nextModule.categories[0]?.id ?? null;
    updateMarker(marker.id, {
      moduleId: nextModule.id,
      categoryId,
    });
    rememberSurveySelection(nextModule.id, categoryId);
    setOpenDropdown(null);
    setExportOpen(false);
  };

  const selectCategory = (category: SurveyCategory) => {
    updateMarker(marker.id, {
      moduleId: activeModule.id,
      categoryId: category.id,
    });
    rememberSurveySelection(activeModule.id, category.id);
    setOpenDropdown(null);
    setExportOpen(false);
  };

  const selectEntity = (entityId: string) => {
    updateMarker(marker.id, { entity: entityId });
    setOpenDropdown(null);
    setExportOpen(false);
  };

  const selectChecklistResponse = (itemId: string, selection: ChecklistSelection) => {
    updateMarker(marker.id, {
      checklistResponses: {
        ...marker.checklistResponses,
        [itemId]: {
          ...(marker.checklistResponses[itemId] || {}),
          selection,
        },
      },
    });
  };

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

  useEffect(() => {
    setNotesEditorOpen(false);
    setNoteDraft(marker.notes ?? '');
    setPhotoDrafts(marker.photos ?? []);
    setVideoDrafts(marker.videos ?? []);
  }, [marker.id]);

  const openNotesEditor = () => {
    setOpenDropdown(null);
    setExportOpen(false);
    setNoteDraft(marker.notes ?? '');
    setPhotoDrafts(marker.photos ?? []);
    setVideoDrafts(marker.videos ?? []);
    setNotesEditorOpen(true);
  };

  const saveNotes = () => {
    updateMarker(marker.id, {
      notes: noteDraft,
      photos: photoDrafts,
      videos: videoDrafts,
    });
    setNotesEditorOpen(false);
  };

  const pickNotesMedia = async (kind: 'photos' | 'videos') => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'photos' ? ['images'] : ['videos'],
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (result.canceled) return;
    const selected = result.assets.map((asset) => asset.fileName || asset.uri).filter(Boolean);
    if (!selected.length) return;
    if (kind === 'photos') {
      setPhotoDrafts((current) => [...current, ...selected]);
      return;
    }
    setVideoDrafts((current) => [...current, ...selected]);
  };

  if (notesEditorOpen) {
    return (
      <Animated.View style={[styles.sheet, { height: sheetHeight, paddingBottom: bottomInset + 10, transform: [{ translateY: slideY }] }]}>
        <View style={styles.sheetFixedTop} {...panResponder.panHandlers}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetEyebrow}>Survey marker</Text>
              <Text numberOfLines={1} style={styles.sheetTitle}>{marker.name}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close notes editor" style={styles.exportButton} onPress={() => setNotesEditorOpen(false)}>
              <X color={colors.text} size={18} />
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.notesEditorScroll} contentContainerStyle={styles.notesEditorContent} showsVerticalScrollIndicator>
          <View style={styles.notesEditorCard}>
            <TextInput
              accessibilityLabel="Survey marker notes"
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Add details..."
              placeholderTextColor={colors.faint}
              style={styles.notesEditorInput}
              multiline
              textAlignVertical="top"
            />
          </View>

          <View style={styles.notesEditorCard}>
            <View style={styles.notesEditorSectionHeader}>
              <Text style={styles.annotationEditLabel}>Attachments</Text>
              <View style={styles.notesUploadRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="Upload photos" style={styles.notesUploadButton} onPress={() => pickNotesMedia('photos')}>
                  <ImageIcon color={colors.text} size={15} />
                  <Text style={styles.notesUploadText}>Photo</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Upload videos" style={styles.notesUploadButton} onPress={() => pickNotesMedia('videos')}>
                  <Video color={colors.text} size={15} />
                  <Text style={styles.notesUploadText}>Video</Text>
                </Pressable>
              </View>
            </View>
            {photoDrafts.length ? photoDrafts.map((photo, index) => (
              <View key={`${photo}-${index}`} style={styles.attachmentRow}>
                <View style={styles.attachmentThumb}><ImageIcon color={colors.blue} size={16} /></View>
                <Text numberOfLines={1} style={styles.attachmentName}>{photo}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${photo}`} style={styles.attachmentRemoveButton} onPress={() => setPhotoDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X color={colors.muted} size={13} />
                </Pressable>
              </View>
            )) : null}
            {videoDrafts.length ? videoDrafts.map((video, index) => (
              <View key={`${video}-${index}`} style={styles.attachmentRow}>
                <View style={styles.attachmentThumb}><Video color={colors.blue} size={16} /></View>
                <Text numberOfLines={1} style={styles.attachmentName}>{video}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${video}`} style={styles.attachmentRemoveButton} onPress={() => setVideoDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <X color={colors.muted} size={13} />
                </Pressable>
              </View>
            )) : null}
            {!photoDrafts.length && !videoDrafts.length ? <Text style={styles.notesEmptyText}>No attachments.</Text> : null}
          </View>
        </ScrollView>

        <View style={styles.notesEditorFooter}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel note edits" style={styles.notesCancelButton} onPress={() => setNotesEditorOpen(false)}>
            <Text style={styles.notesCancelText}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save note" style={styles.notesSaveButton} onPress={saveNotes}>
            <Text style={styles.notesSaveText}>Save</Text>
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.sheet, { height: sheetHeight, paddingBottom: bottomInset + 10, transform: [{ translateY: slideY }] }]}
    >
      <View style={styles.sheetFixedTop} {...panResponder.panHandlers}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View style={styles.sheetTitleColumn}>
            <Text style={styles.sheetEyebrow}>Survey template</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose survey template"
              style={styles.templateTitleButton}
              onPress={() => {
                setExportOpen(false);
                setOpenDropdown(openDropdown === 'template' ? null : 'template');
              }}
            >
              <Text numberOfLines={1} style={styles.sheetTitle}>{selectedTemplateName}</Text>
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
                      setExportOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.sheetHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Export survey data"
              style={[styles.exportButton, exportOpen && styles.exportButtonActive]}
              onPress={() => {
                setOpenDropdown(null);
                setExportOpen((open) => !open);
              }}
            >
              <ExportIcon color={exportOpen ? colors.blue : colors.text} size={20} />
            </Pressable>
            {exportOpen ? (
              <View style={styles.exportMenu}>
                <Pressable accessibilityRole="button" accessibilityLabel="Export as Excel" style={styles.exportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.exportMenuTitle}>Export Excel</Text>
                  <Text style={styles.exportMenuMeta}>Create workbook from survey data</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Sync to Microsoft 365" style={styles.exportMenuItem} onPress={() => setExportOpen(false)}>
                  <Text style={styles.exportMenuTitle}>Sync Microsoft 365</Text>
                  <Text style={styles.exportMenuMeta}>Update the shared workbook location</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.sheetRow}>
          <View style={styles.moduleNavigator}>
            <Pressable
              disabled={!canGoBack}
              style={[styles.moduleArrow, !canGoBack && styles.moduleArrowDisabled]}
              onPress={() => selectModule(moduleIndex - 1)}
            >
              <ChevronLeft color={canGoBack ? colors.text : colors.faint} size={18} />
            </Pressable>
            <View style={styles.moduleDropdownWrap}>
              <Pressable
                style={styles.moduleCenter}
                onPress={() => {
                  setExportOpen(false);
                  setOpenDropdown(openDropdown === 'module' ? null : 'module');
                }}
              >
                <Text style={styles.moduleCenterText}>{activeModule.name}</Text>
                <ChevronDown color={colors.muted} size={14} />
              </Pressable>
              {openDropdown === 'module' ? (
                <View style={styles.dropdownMenu}>
                  {modules.map((module, index) => (
                    <Pressable
                      key={module.id}
                      style={[styles.dropdownItem, module.id === activeModule.id && styles.dropdownItemActive]}
                      onPress={() => selectModule(index)}
                    >
                      <Text style={styles.dropdownItemText}>{module.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <Pressable
              disabled={!canGoForward}
              style={[styles.moduleArrow, !canGoForward && styles.moduleArrowDisabled]}
              onPress={() => selectModule(moduleIndex + 1)}
            >
              <ChevronRight color={canGoForward ? colors.text : colors.faint} size={18} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.sheetFixedBody}>
        <Text style={styles.compactFieldLabel}>Category</Text>
        <View style={[styles.dropdownWrap, openDropdown === 'category' && styles.dropdownWrapActive]}>
          <Pressable
            style={[styles.compactDropdownField, !activeCategory && styles.dropdownFieldEmpty]}
            onPress={() => {
              setExportOpen(false);
              setOpenDropdown(openDropdown === 'category' ? null : 'category');
            }}
          >
            <Text style={[styles.dropdownValue, !activeCategory && styles.dropdownPlaceholder]}>
              {activeCategory?.name ?? 'Choose category'}
            </Text>
            <ChevronDown color={colors.muted} size={15} />
          </Pressable>
          {openDropdown === 'category' ? (
            <View style={styles.dropdownMenu}>
              {activeModule.categories.map((category) => (
                <Pressable
                  key={category.id}
                  style={[styles.dropdownItem, category.id === activeCategory?.id && styles.dropdownItemActive]}
                  onPress={() => selectCategory(category)}
                >
                  <Text style={styles.dropdownItemText}>{category.name}</Text>
                  <Text style={styles.dropdownMeta}>{category.checklist.length}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Text style={styles.compactFieldLabel}>Category Item</Text>
        <View style={[styles.markerToolsWrap, (openDropdown === 'entity' || openDropdown === 'markerItem') && styles.dropdownWrapActive]}>
          <View style={styles.markerToolsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose marker entity"
              style={[styles.markerEntitySwatchButton, !activeEntity && styles.markerEntitySwatchEmpty]}
              onPress={() => {
                setExportOpen(false);
                setOpenDropdown(openDropdown === 'entity' ? null : 'entity');
              }}
            >
              <View style={[styles.markerEntitySwatch, { backgroundColor: activeEntity?.color ?? 'transparent' }]} />
            </Pressable>
            <View style={styles.markerItemFieldWrap}>
              <View style={styles.markerItemInputRow}>
                <TextInput
                  accessibilityLabel="Rename category item"
                  value={marker.name}
                  onChangeText={(value) => updateMarker(marker.id, { name: value })}
                  onFocus={() => {
                    setOpenDropdown(null);
                    setExportOpen(false);
                  }}
                  onBlur={() => {
                    const fallbackName = activeCategory ? `${activeCategory.name} ${marker.id}` : `Survey Marker ${marker.id}`;
                    if (!marker.name.trim()) updateMarker(marker.id, { name: fallbackName });
                  }}
                  placeholder="Category item"
                  placeholderTextColor={colors.faint}
                  style={styles.markerNameInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose category item"
                  style={styles.markerItemDropdownButton}
                  onPress={() => {
                    setExportOpen(false);
                    setOpenDropdown(openDropdown === 'markerItem' ? null : 'markerItem');
                  }}
                >
                  <ChevronDown color={colors.muted} size={14} />
                </Pressable>
              </View>
              {openDropdown === 'markerItem' ? (
                <View style={styles.markerItemMenu}>
                  {categoryItems.length ? categoryItems.map((item) => (
                    <Pressable
                      key={item.id}
                      style={[styles.dropdownItem, item.id === marker.id && styles.dropdownItemActive]}
                      onPress={() => {
                        onSelectMarker(item.id);
                        setOpenDropdown(null);
                        setExportOpen(false);
                      }}
                    >
                      <Text numberOfLines={1} style={styles.dropdownItemText}>{item.name}</Text>
                    </Pressable>
                  )) : (
                    <View style={styles.dropdownItem}>
                      <Text style={styles.dropdownItemText}>No category items yet</Text>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Locate marker on PDF" style={styles.locateMarkerButton} onPress={() => onLocateMarker(marker)}>
              <Search color={colors.blue} size={16} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={marker.notes ? 'Edit marker notes' : 'Add marker notes'} style={styles.markerNotesIconButton} onPress={openNotesEditor}>
              <PenLine color={marker.notes ? '#4A90E2' : '#999'} size={15} />
            </Pressable>
          </View>
          {openDropdown === 'entity' ? (
            <View style={styles.markerEntityMenu}>
              {entities.map((entity) => (
                <Pressable
                  key={entity.id}
                  style={[styles.dropdownItem, marker.entity === entity.id && styles.dropdownItemActive]}
                  onPress={() => selectEntity(entity.id)}
                >
                  <View style={[styles.entityDot, { backgroundColor: entity.color }]} />
                  <Text style={styles.dropdownItemText}>{entity.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.checkHeader}>
          <Text style={styles.compactFieldLabel}>Checklist</Text>
          <Text style={styles.assignedText}>Court: {entityName}</Text>
        </View>
      </View>

      {activeCategory ? (
        <ScrollView
          style={[styles.checkListScroll, { height: checklistWindowHeight }]}
          contentContainerStyle={styles.checkList}
          showsVerticalScrollIndicator={checklistItems.length > MAX_VISIBLE_CHECKLIST_ITEMS}
        >
          {checklistItems.map((item) => {
            const response = marker.checklistResponses[item.id]?.selection;
            return (
              <View key={item.id} style={styles.checkItem}>
                <Text numberOfLines={1} style={styles.checkText}>{item.text}</Text>
                <View style={styles.checkResponseGroup}>
                  {(['Y', 'N', 'N/A'] as ChecklistSelection[]).map((selection) => (
                    <Pressable
                      key={selection}
                      accessibilityRole="button"
                      accessibilityState={{ selected: response === selection }}
                      accessibilityLabel={`${item.text} ${selection}`}
                      style={[
                        styles.checkResponseButton,
                        response === selection && styles.checkResponseButtonActive,
                        response === selection && selection === 'Y' && styles.checkResponseYes,
                        response === selection && selection === 'N' && styles.checkResponseNo,
                        response === selection && selection === 'N/A' && styles.checkResponseNa,
                      ]}
                      onPress={() => selectChecklistResponse(item.id, selection)}
                    >
                      <Text style={[styles.checkResponseText, response === selection && styles.checkResponseTextActive]}>{selection}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View style={[styles.emptyChecklist, { height: checklistWindowHeight }]}>
          <Text style={styles.emptyChecklistText}>Choose category first</Text>
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


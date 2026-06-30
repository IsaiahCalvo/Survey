import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Bookmark, Check, Copy, FileText, Plus, Search, X } from 'lucide-react-native';
import type { HubMode, Marker, InkMark, BookmarkEntry, PageClipboard, PageTransformState } from '../../types';
import { colors, pdfTextMatches } from '../../constants';
import { styles } from '../../styles';
import { HubTab } from './HubTab';
import { PageThumb } from './PageThumb';
import { BookmarkRow } from './BookmarkRow';

export function HubTray({
  hubMode,
  setHubMode,
  currentPage,
  currentPageOrdinal,
  setCurrentPage,
  markers,
  inkMarks,
  bookmarks,
  pageOrder,
  totalPages,
  pageTransforms,
  pageClipboard,
  onMoveBookmark,
  onMovePage,
  onOpenPageMenu,
  openSurvey,
  searchValue,
  setSearchValue,
  close,
  panelHeight,
  bottomInset,
}: {
  hubMode: HubMode;
  setHubMode: (mode: HubMode) => void;
  currentPage: number;
  currentPageOrdinal: number;
  setCurrentPage: (page: number) => void;
  markers: Marker[];
  inkMarks: InkMark[];
  bookmarks: BookmarkEntry[];
  pageOrder: number[];
  totalPages: number;
  pageTransforms: Record<number, PageTransformState>;
  pageClipboard: PageClipboard | null;
  onMoveBookmark: (bookmarkId: string, delta: number) => void;
  onMovePage: (page: number, delta: number) => void;
  onOpenPageMenu: (page: number, anchorX: number, anchorY: number) => void;
  openSurvey: (markerId: number) => void;
  searchValue: string;
  setSearchValue: (value: string) => void;
  close: () => void;
  panelHeight: number;
  bottomInset: number;
}) {
  const normalizedSearch = searchValue.trim().toLowerCase();
  const searchResults = normalizedSearch
    ? pdfTextMatches.filter((match) => `${match.title} ${match.excerpt}`.toLowerCase().includes(normalizedSearch))
    : [];

  return (
    <View style={[styles.hubTray, { height: panelHeight, paddingBottom: bottomInset + 14 }]}>
      <View style={styles.hubGrabber} />
      <View style={styles.hubTabs}>
        <HubTab mode="pages" activeMode={hubMode} setHubMode={setHubMode} icon={FileText} label="Pages" />
        <HubTab mode="search" activeMode={hubMode} setHubMode={setHubMode} icon={Search} label="Search" />
        <HubTab mode="bookmarks" activeMode={hubMode} setHubMode={setHubMode} icon={Bookmark} label="Bookmarks" />
        <Pressable accessibilityRole="button" accessibilityLabel="Close document hub" style={styles.hubClose} onPress={close}>
          <X color={colors.text} size={16} />
        </Pressable>
      </View>

      {hubMode === 'pages' ? (
        <>
          <View style={styles.pageCounterRow}>
            <View style={styles.pageCounterPill}>
              <Text style={styles.pageCounterValue}>{currentPageOrdinal}</Text>
            </View>
            <Text style={styles.pageCounterMeta}>/ {totalPages} pages</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pageThumbScroller}
            contentContainerStyle={styles.pageThumbTrack}
          >
            {pageOrder.map((page, index) => (
              <PageThumb
                key={page}
                page={page}
                displayNumber={index + 1}
                active={currentPage === page}
                markers={markers.filter((marker) => marker.page === page)}
                inkMarks={inkMarks.filter((mark) => mark.page === page)}
                transformState={pageTransforms[page]}
                clipboardActive={pageClipboard?.page === page}
                onMove={onMovePage}
                onOpenMenu={onOpenPageMenu}
                onPress={() => setCurrentPage(page)}
              />
            ))}
          </ScrollView>
          <View style={styles.hubActionPill}>
            <Pressable accessibilityRole="button" accessibilityLabel="Add page" style={styles.hubActionButton}>
              <Plus color={colors.text} size={16} />
              <Text style={styles.hubActionText}>Add</Text>
            </Pressable>
            <View style={styles.hubActionDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel="Paste page" style={styles.hubActionButton}>
              <Copy color={colors.text} size={15} />
              <Text style={styles.hubActionText}>Paste</Text>
            </Pressable>
            <View style={styles.hubActionDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel="Select pages" style={styles.hubActionButton}>
              <Check color={colors.text} size={16} />
              <Text style={styles.hubActionText}>Select</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {hubMode === 'search' ? (
        <>
          <View style={styles.searchBox}>
            <Search color={colors.muted} size={17} />
            <TextInput
              value={searchValue}
              onChangeText={setSearchValue}
              placeholder="Search text"
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
            />
          </View>
          {normalizedSearch ? (
            <ScrollView style={styles.resultList}>
              {searchResults.length > 0 ? (
                searchResults.map((match) => (
                  <Pressable key={match.id} style={styles.resultRow} onPress={() => setCurrentPage(match.page)}>
                    <Text style={styles.resultTitle}>{match.title}</Text>
                    <Text style={styles.resultMeta}>Page {match.page} · {match.excerpt}</Text>
                  </Pressable>
                ))
              ) : (
                <View style={styles.searchEmptyState}>
                  <Search color={colors.green} size={44} />
                  <Text style={styles.searchEmptyTitle}>No text matches</Text>
                  <Text style={styles.searchEmptyMeta}>Try another word from the PDF.</Text>
                </View>
              )}
            </ScrollView>
          ) : (
            <View style={styles.searchEmptyState}>
              <Search color={colors.green} size={54} />
              <Text style={styles.searchEmptyTitle}>Looking for a specific word?</Text>
              <Text style={styles.searchEmptyMeta}>Search visible PDF text and jump to the matching page.</Text>
            </View>
          )}
        </>
      ) : null}

      {hubMode === 'bookmarks' ? (
        <View style={styles.bookmarkList}>
          <ScrollView style={styles.bookmarkRows} contentContainerStyle={styles.bookmarkRowsContent} showsVerticalScrollIndicator={bookmarks.length > 4}>
            {bookmarks.length ? (
              [...bookmarks].sort((a, b) => a.order - b.order).map((bookmark, index, ordered) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  first={index === 0}
                  last={index === ordered.length - 1}
                  onMove={onMoveBookmark}
                  onPress={() => {
                    if (bookmark.markerId) {
                      openSurvey(bookmark.markerId);
                      return;
                    }
                    if (bookmark.page) setCurrentPage(bookmark.page);
                  }}
                />
              ))
            ) : (
              <View style={styles.bookmarkEmpty}>
                <Bookmark color={colors.muted} size={20} />
                <Text style={styles.bookmarkEmptyText}>No bookmarks yet</Text>
              </View>
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

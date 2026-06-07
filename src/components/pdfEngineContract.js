/**
 * pdfEngineContract.js — the single "doorway" interface contract for the PDF
 * page-drawing engine (Phase 37 — Syncfusion → owned pdf.js cutover).
 *
 * This file is DOCUMENTATION + a machine-checkable spec. It has no runtime
 * behavior and is intentionally not imported by PDFViewer's render path. Both
 * the current Syncfusion container (`SyncfusionPDFContainer.jsx`) and the future
 * pdf.js container must satisfy the imperative-ref shape and accept the props
 * described here, so that the engine can be swapped behind one seam without
 * touching the ~929 call sites in PDFViewer.jsx.
 *
 * Source of truth: this contract was transcribed directly from the live
 * `useImperativeHandle` and props of `SyncfusionPDFContainer.jsx` (verified
 * 2026-06-01), NOT from an audit guess. When that component changes, update
 * this file in the same commit.
 *
 * IMPORTANT: the engine-selection flag lives in `viewerShared.js`
 * (`getPDFViewerEngine`), deliberately SEPARATE from the in-PDFViewer
 * `useSyncfusionRenderer` flag, which gates overlay/zoom *behavior*, not which
 * engine mounts. Do not conflate the two.
 */

/**
 * @typedef {Object} PdfEngineHandle
 * The imperative API exposed via `useImperativeHandle` (i.e. what
 * `viewerRef.current` must provide). A drop-in engine must implement every
 * member below with matching call signatures and return contracts.
 *
 * Navigation:
 * @property {(page:number)=>boolean} goToPage
 * @property {(sourceId:string, destOverride?:any, preferSourceLookup?:boolean)=>boolean} goToBookmarkSource
 * @property {(sourceId:string, destOverride?:any, preferSourceLookup?:boolean)=>(number|null)} resolveBookmarkPageFromSource
 * @property {{goToPage:(page:number)=>boolean}} navigationModule
 *
 * State getters (both method and property forms exist on the Syncfusion handle):
 * @property {()=>number} getPageCount
 * @property {()=>number} getCurrentPage
 * @property {()=>number} getZoomValue
 * @property {number} pageCount               (getter)
 * @property {number} currentPageNumber       (getter)
 * @property {number} zoomValue               (getter)
 * @property {HTMLElement|null} element        (getter — the viewer host element)
 * @property {any} viewerBase                  (getter — engine-internal; avoid relying on shape)
 *
 * Per-page DOM resolution (the overlay-pinning seam):
 * @property {(page:number)=>HTMLElement|null} getPageContainer
 * @property {()=>Object<number,HTMLElement>} getPageContainers
 * @property {()=>HTMLElement|null} getViewerContainer
 * @property {()=>HTMLElement|null} getPageLayerContainer
 *
 * Zoom:
 * @property {{zoomTo:(z:number)=>void, fitToPage:()=>void, fitToWidth:()=>void, initiateMouseZoom:(x:number,y:number,z:number)=>void}} magnificationModule
 *
 * Document load / save / print / thumbnails:
 * @property {(source:any, password?:string)=>void} load
 * @property {()=>Promise<Blob|null>} saveAsBlob
 * @property {()=>boolean} print
 * @property {(...args:any[])=>(string|Promise<string>)} getThumbnailDataUrl
 * @property {()=>Array} getPDFBookmarks
 *
 * Text search:
 * @property {(query:string, matchCase?:boolean)=>Promise<any>} findTextAsync
 * @property {(query:string, matchCase?:boolean)=>boolean} searchText
 * @property {(query:string, matchCase?:boolean, options?:any)=>boolean} refreshTextSearchHighlights
 * @property {(query:string, matchIndex?:number, matchCase?:boolean)=>Promise<boolean>} searchToMatch
 * @property {()=>void} cancelTextSearch
 *
 * Text selection + text-markup annotations:
 * @property {(pageNumber:number, point:{x:number,y:number}, radius?:number, event?:any)=>any} selectTextMarkupAtPoint
 * @property {(clientX:number, clientY:number, radius?:number, event?:any)=>any} selectTextMarkupAtClientPoint
 * @property {()=>boolean} deleteSelectedTextMarkupAnnotation
 * @property {(pageNumber:number, points?:Array, radius?:number)=>number} eraseTextMarkupAtPoints
 * @property {()=>void} clearTextSelection
 * @property {{clearTextSelection:()=>void}} textSelectionModule
 *
 * Form fields (KAL-47; fill/edit existing only — authoring is out of scope):
 * @property {(enabled:boolean)=>boolean} setDesignerMode
 * @property {(type:string, options:any)=>boolean} setFormFieldMode
 * @property {(type:string, options:any)=>any} addFormField
 * @property {(id:string, options:any)=>boolean} updateFormField
 * @property {(idOrObject:any)=>boolean} deleteFormField
 * @property {(id:string)=>boolean} selectFormField
 * @property {()=>Array} getFormFieldCollection
 */

/**
 * @typedef {Object} PdfEngineProps
 * Config props:
 * @property {string} [id]
 * @property {string} [resourceUrl]
 * @property {any} [documentSource]
 * @property {'Pan'|'TextSelection'} [interactionMode]
 * @property {number} [initialRenderPages]
 * @property {number} [scrollDelayMs]
 * @property {boolean} [suspendContainerRefresh]
 * @property {boolean} [restrictZoomRequest]
 * @property {boolean} [textHighlightModeActive]
 * @property {string} [textHighlightColor]
 * @property {number} [textHighlightOpacity]
 * @property {string|null} [textMarkupMode]
 * @property {string|null} [textMarkupColor]
 * @property {number|null} [textMarkupOpacity]
 * @property {string} [className]
 * @property {Object} [style]
 * @property {boolean} [formDesignerEnabled]
 *
 * Event callbacks:
 * @property {(info:{pageCount:number,currentPageNumber:number,zoomValue:number,raw:any})=>void} [onDocumentLoaded]
 * @property {(info:any)=>void} [onDocumentLoadFailed]
 * @property {(info:any)=>void} [onPageChanged]
 * @property {(info:any)=>void} [onZoomChanged]
 * @property {(info:any)=>void} [onPageRendered]
 * @property {(info:any)=>void} [onTextSelectionEnd]
 * @property {(bookmarks:any)=>void} [onPDFBookmarksAvailable]
 * @property {(map:Object<number,HTMLElement>)=>void} [onPageContainersChange]
 * @property {(event:any)=>void} [onDebugEvent]
 * @property {()=>void} [onDocumentUnload]
 * @property {(info:any)=>void} [onFormFieldAdd]
 * @property {(info:any)=>void} [onFormFieldSelect]
 * @property {(info:any)=>void} [onFormFieldUnselect]
 * @property {(info:any)=>void} [onFormFieldRemove]
 * @property {(info:any)=>void} [onFormFieldPropertiesChange]
 * @property {(info:any)=>void} [onFormFieldClick]
 * @property {(info:any)=>void} [onFormFieldDoubleClick]
 */

/**
 * The imperative-handle member names a conforming engine MUST expose. Useful for
 * a parity test that asserts a candidate engine implements the full contract.
 * @type {ReadonlyArray<string>}
 */
export const PDF_ENGINE_HANDLE_METHODS = Object.freeze([
  'goToPage',
  'goToBookmarkSource',
  'resolveBookmarkPageFromSource',
  'getPageCount',
  'getCurrentPage',
  'getZoomValue',
  'getPageContainer',
  'getPageContainers',
  'getViewerContainer',
  'getPageLayerContainer',
  'getThumbnailDataUrl',
  'getPDFBookmarks',
  'print',
  'load',
  'saveAsBlob',
  'findTextAsync',
  'searchText',
  'refreshTextSearchHighlights',
  'searchToMatch',
  'cancelTextSearch',
  'selectTextMarkupAtPoint',
  'selectTextMarkupAtClientPoint',
  'deleteSelectedTextMarkupAnnotation',
  'eraseTextMarkupAtPoints',
  'clearTextSelection',
  'navigationModule',
  'magnificationModule',
  'textSelectionModule',
  'setDesignerMode',
  'setFormFieldMode',
  'addFormField',
  'updateFormField',
  'deleteFormField',
  'selectFormField',
  'getFormFieldCollection',
]);

/**
 * Getter members a conforming engine MUST expose on its handle (property form).
 * @type {ReadonlyArray<string>}
 */
export const PDF_ENGINE_HANDLE_GETTERS = Object.freeze([
  'viewerBase',
  'element',
  'pageCount',
  'currentPageNumber',
  'zoomValue',
]);

export const SCHEMA = 1 as const
export const PREVIEW_VERSION = 'pdfjs-6.5.438-normalized-v1'
export type Point = { x: number; y: number }
export type Region = Point & { width: number; height: number }
export type DocumentInfo = { id: string; name: string; originalFormat: 'pdf'; previewFormat: 'pdf'; previewVersion: string; pages: { width: number; height: number }[] }
export type Anchor = { documentId: string; previewVersion: string; page: number; space: 'normalized-top-left'; regions: Region[]; text?: string; precision: 'region' | 'text' | 'page' }
type BaseAnnotation = { id: string; anchor: Anchor; updatedAt: string; schema: 1 }
export type Annotation = BaseAnnotation & ({ kind: 'ink'; points: Point[]; color: string; width: number } | { kind: 'highlight'; color: string } | { kind: 'note'; text: string; collapsed?: boolean; color?: string })
export type ReaderState = { page: number; zoom: number | 'fit' | 'page'; scroll: Point; selection: Anchor | null; panelOpen: boolean; draft: string; context: Anchor | null }
export type Snapshot = { schema: 1; document: DocumentInfo; annotations: Annotation[]; reader: ReaderState; savedAt: string }
export type Mode = 'read' | 'text' | 'region' | 'ink' | 'erase'
export type FixtureReference = { fixture: true; label: string; target: Anchor }
export const initialReader = (): ReaderState => ({ page: 1, zoom: 'fit', scroll: { x: 0, y: 0 }, selection: null, panelOpen: false, draft: '', context: null })

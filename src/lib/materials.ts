import type { Source } from './api'
export type MaterialFilter = 'all' | 'readable' | 'processing'
export const isPdf = (source: Pick<Source, 'extension'>) => source.extension.replace(/^\./, '').toLowerCase() === 'pdf'
export function filterMaterials(sources: Source[], query: string, filter: MaterialFilter) {
  return sources.filter(source => source.original_name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (filter === 'all' || (filter === 'readable' ? isPdf(source) : !isPdf(source) || source.status !== 'ready')))
}
export function materialsPreference(courseId: string): {query: string; filter: MaterialFilter} {
  try {
    const value = JSON.parse(sessionStorage.getItem('materials-view:' + courseId) || 'null')
    return {query: typeof value?.query === 'string' ? value.query : '', filter: ['all','readable','processing'].includes(value?.filter) ? value.filter : 'all'}
  } catch { return {query: '', filter: 'all'} }
}
export {readingRoute as readerHref} from './workspaceRoute'
export type ReadingSummary = {sourceId: string; name: string; sha256: string; previewVersion: string; page: number; revision: number; updatedAt: string; readOnly: boolean}

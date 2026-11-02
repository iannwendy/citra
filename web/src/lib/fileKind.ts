/**
 * Small filename helpers shared by export controls.
 *
 * The backend `/essays/{id}/export-healed-docx` endpoint can only rewrite the
 * bibliography of an original Word document — it returns HTTP 400 for PDF
 * uploads — so UI controls use `isDocxFilename` to disable that action.
 */
export function isDocxFilename(filename: string | null | undefined): boolean {
  if (!filename) return false;
  return /\.docx$/i.test(filename.trim());
}

export type ExportFormat = 'json' | 'csv' | 'pdf' | 'docx';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'csv', 'pdf', 'docx'];

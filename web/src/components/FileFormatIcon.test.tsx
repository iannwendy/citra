import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  FileFormatIcon,
  FileFormatBadge,
  getDocumentFormat,
} from './FileFormatIcon';

describe('FileFormatIcon & FileFormatBadge', () => {
  it('detects PDF vs DOCX vs BIB vs RIS filenames accurately', () => {
    expect(getDocumentFormat('kHOA HỌC DỮ LIỆU - NHÓM 6.pdf')).toBe('pdf');
    expect(getDocumentFormat('CITRA_ACL_Sandbox_APA_10refs.PDF')).toBe('pdf');
    expect(getDocumentFormat('demo_29.09.docx')).toBe('docx');
    expect(getDocumentFormat('manuscript_final.DOCX')).toBe('docx');
    expect(getDocumentFormat('legacy.doc')).toBe('docx');
    expect(getDocumentFormat('references.bib')).toBe('bib');
    expect(getDocumentFormat('ACL_2025.BIB')).toBe('bib');
    expect(getDocumentFormat('zotero_export.ris')).toBe('ris');
    expect(getDocumentFormat('endnote.RIS')).toBe('ris');
    expect(getDocumentFormat('')).toBe('pdf');
  });

  it('renders distinct PDF, DOCX, BIB, and RIS vector logos and badges', () => {
    const { unmount } = render(
      <div>
        <FileFormatIcon filename="kHOA HỌC DỮ LIỆU - NHÓM 6.pdf" size="md" />
        <FileFormatBadge filename="kHOA HỌC DỮ LIỆU - NHÓM 6.pdf" />
      </div>,
    );
    expect(screen.getByTestId('file-format-icon-pdf')).toBeDefined();
    expect(screen.getByTestId('file-format-badge-pdf').textContent).toContain('PDF');
    unmount();

    const { unmount: unmountDocx } = render(
      <div>
        <FileFormatIcon filename="demo_29.09.docx" size="md" />
        <FileFormatBadge filename="demo_29.09.docx" />
      </div>,
    );
    expect(screen.getByTestId('file-format-icon-docx')).toBeDefined();
    expect(screen.getByTestId('file-format-badge-docx').textContent).toContain('DOCX');
    unmountDocx();

    const { unmount: unmountBib } = render(
      <div>
        <FileFormatIcon filename="references.bib" size="md" />
        <FileFormatBadge filename="references.bib" />
      </div>,
    );
    expect(screen.getByTestId('file-format-icon-bib')).toBeDefined();
    expect(screen.getByTestId('file-format-badge-bib').textContent).toContain('BIB');
    unmountBib();

    render(
      <div>
        <FileFormatIcon filename="zotero_export.ris" size="md" />
        <FileFormatBadge filename="zotero_export.ris" />
      </div>,
    );
    expect(screen.getByTestId('file-format-icon-ris')).toBeDefined();
    expect(screen.getByTestId('file-format-badge-ris').textContent).toContain('RIS');
  });
});

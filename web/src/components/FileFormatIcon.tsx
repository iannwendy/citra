import React from 'react';

export type DocumentFormat = 'pdf' | 'docx' | 'bib' | 'ris';

export function getDocumentFormat(filename?: string | null): DocumentFormat {
  if (!filename) return 'pdf';
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return 'docx';
  }
  if (lower.endsWith('.bib') || lower.endsWith('.bibtex')) {
    return 'bib';
  }
  if (lower.endsWith('.ris')) {
    return 'ris';
  }
  return 'pdf';
}

export interface FileFormatIconProps {
  filename?: string | null;
  format?: DocumentFormat;
  /**
   * - 'xs': 18x18 inline icon (e.g. window chrome bar, buttons)
   * - 'sm': 32x32 compact tile (e.g. batch queue, class submissions)
   * - 'md': 40x40 standard table tile (e.g. Dashboard & History rows)
   * - 'lg': 44x44 header tile (e.g. Verification Report header & Upload preview)
   */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Distinct, immediately recognizable vector logos for PDF (Crimson Adobe-style PDF emblem)
 * and DOCX (Royal Blue Microsoft Word "W" + document emblem).
 */
export const FileFormatIcon: React.FC<FileFormatIconProps> = ({
  filename,
  format,
  size = 'md',
  className = '',
}) => {
  const resolvedFormat: DocumentFormat = format ?? getDocumentFormat(filename);
  const isDocx = resolvedFormat === 'docx';
  const isBib = resolvedFormat === 'bib';
  const isRis = resolvedFormat === 'ris';

  if (size === 'xs') {
    if (isBib) {
      return (
        <span
          data-testid="file-format-icon-bib"
          title="BibTeX Bibliography (.BIB)"
          className={`inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/70 text-emerald-700 dark:text-emerald-400 text-[8px] font-mono font-extrabold shrink-0 select-none ${className}`}
        >
          BIB
        </span>
      );
    }
    if (isRis) {
      return (
        <span
          data-testid="file-format-icon-ris"
          title="RIS Bibliography (.RIS)"
          className={`inline-flex items-center justify-center w-5 h-5 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700/70 text-amber-700 dark:text-amber-400 text-[8px] font-mono font-extrabold shrink-0 select-none ${className}`}
        >
          RIS
        </span>
      );
    }
    return isDocx ? (
      <span
        data-testid="file-format-icon-docx"
        title="Microsoft Word (.DOCX)"
        className={`inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#EFF6FF] dark:bg-[#1E3A8A]/50 border border-[#93C5FD] dark:border-[#3B82F6]/60 text-[#1D4ED8] dark:text-[#60A5FA] shrink-0 select-none ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M14 2v5h5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.3 11.2 8.9 17.5l1.6-4.5 1.6 4.5 1.6-6.3"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    ) : (
      <span
        data-testid="file-format-icon-pdf"
        title="PDF Document (.PDF)"
        className={`inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#FEF2F2] dark:bg-[#7F1D1D]/45 border border-[#FCA5A5] dark:border-[#EF4444]/60 text-[#DC2626] dark:text-[#F87171] shrink-0 select-none ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M14 2v5h5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 9.2c-1.1 2.7-2.7 5.2-4.6 6.8 2.2-.8 5.2-1.2 8.2-.7-1.6-1.3-2.9-3.5-3.6-6.1Z"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  const containerSizeClass =
    size === 'sm'
      ? 'w-8 h-8 sm:w-9 sm:h-9 rounded-xl'
      : size === 'lg'
        ? 'w-11 h-11 sm:w-12 sm:h-12 rounded-2xl'
        : 'w-9 h-9 sm:w-10 sm:h-10 rounded-xl';

  const svgSizeClass =
    size === 'sm'
      ? 'w-5 h-5 sm:w-5 sm:h-5'
      : size === 'lg'
        ? 'w-7 h-7 sm:w-7 sm:h-7'
        : 'w-5 h-5 sm:w-6 sm:h-6';

  if (isBib) {
    return (
      <div
        data-testid="file-format-icon-bib"
        title="BibTeX Bibliography (.BIB)"
        aria-label="BibTeX Bibliography"
        className={`${containerSizeClass} bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700/70 text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:border-emerald-600 group-hover:text-white flex items-center justify-center shrink-0 transition-all duration-200 shadow-2xs select-none ${className}`}
      >
        <svg
          viewBox="0 0 32 32"
          className={svgSizeClass}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M8 3.5h11.2L25.5 9.8V26a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 26V6A2.5 2.5 0 0 1 8 3.5Z"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M19 3.5V10h6.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="15.5"
            y="16.5"
            textAnchor="middle"
            fill="currentColor"
            fontSize="7.2"
            fontWeight="800"
            fontFamily="JetBrains Mono, Inter, system-ui, sans-serif"
          >
            @{"{}"}
          </text>
          <rect x="6.5" y="20.4" width="18" height="5.8" rx="1.6" fill="#059669" />
          <text
            x="15.5"
            y="24.5"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="4.7"
            fontWeight="800"
            fontFamily="JetBrains Mono, Inter, system-ui, sans-serif"
            letterSpacing="0.06em"
          >
            BIB
          </text>
        </svg>
      </div>
    );
  }

  if (isRis) {
    return (
      <div
        data-testid="file-format-icon-ris"
        title="Research Information Systems (.RIS)"
        aria-label="RIS Bibliography"
        className={`${containerSizeClass} bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-700/70 text-amber-700 dark:text-amber-400 group-hover:bg-amber-600 group-hover:border-amber-600 group-hover:text-white flex items-center justify-center shrink-0 transition-all duration-200 shadow-2xs select-none ${className}`}
      >
        <svg
          viewBox="0 0 32 32"
          className={svgSizeClass}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M8 3.5h11.2L25.5 9.8V26a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 26V6A2.5 2.5 0 0 1 8 3.5Z"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M19 3.5V10h6.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="15.5"
            y="16.2"
            textAnchor="middle"
            fill="currentColor"
            fontSize="6.5"
            fontWeight="800"
            fontFamily="JetBrains Mono, Inter, system-ui, sans-serif"
          >
            TY-
          </text>
          <rect x="6.5" y="20.4" width="18" height="5.8" rx="1.6" fill="#D97706" />
          <text
            x="15.5"
            y="24.5"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="4.7"
            fontWeight="800"
            fontFamily="JetBrains Mono, Inter, system-ui, sans-serif"
            letterSpacing="0.06em"
          >
            RIS
          </text>
        </svg>
      </div>
    );
  }

  if (isDocx) {
    return (
      <div
        data-testid="file-format-icon-docx"
        title="Microsoft Word Document (.DOCX)"
        aria-label="DOCX Document"
        className={`${containerSizeClass} bg-[#EFF6FF] dark:bg-[#172554]/85 border border-[#93C5FD] dark:border-[#1D4ED8]/70 text-[#1D4ED8] dark:text-[#60A5FA] group-hover:bg-[#2563EB] group-hover:border-[#2563EB] group-hover:text-white flex items-center justify-center shrink-0 transition-all duration-200 shadow-2xs select-none ${className}`}
      >
        <svg
          viewBox="0 0 32 32"
          className={svgSizeClass}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Document Page Sheet */}
          <path
            d="M8 3.5h11.2L25.5 9.8V26a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 26V6A2.5 2.5 0 0 1 8 3.5Z"
            fill="currentColor"
            fillOpacity="0.12"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Folded Corner */}
          <path
            d="M19 3.5V10h6.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Subtle text lines at top right */}
          <path
            d="M14.5 13h7.5M14.5 16.2h7.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.65"
          />
          {/* Microsoft Word "W" Emblem Tile on Left + Bottom DOCX Ribbon */}
          <rect
            x="3"
            y="11"
            width="11"
            height="11"
            rx="2.4"
            fill="#1D4ED8"
            stroke="#FFFFFF"
            strokeWidth="1.2"
          />
          <path
            d="M5.3 13.7 6.7 19.3l1.8-4.2 1.8 4.2 1.4-5.6"
            stroke="#FFFFFF"
            strokeWidth="1.55"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Bottom DOCX Pill */}
          <rect x="7.5" y="21.2" width="16" height="5.4" rx="1.5" fill="#1E40AF" />
          <text
            x="15.5"
            y="25.1"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="4.3"
            fontWeight="800"
            fontFamily="JetBrains Mono, Inter, system-ui, sans-serif"
            letterSpacing="0.04em"
          >
            DOCX
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div
      data-testid="file-format-icon-pdf"
      title="Portable Document Format (.PDF)"
      aria-label="PDF Document"
      className={`${containerSizeClass} bg-[#FEF2F2] dark:bg-[#450A0A]/80 border border-[#FCA5A5] dark:border-[#B91C1C]/70 text-[#DC2626] dark:text-[#F87171] group-hover:bg-[#DC2626] group-hover:border-[#DC2626] group-hover:text-white flex items-center justify-center shrink-0 transition-all duration-200 shadow-2xs select-none ${className}`}
    >
      <svg
        viewBox="0 0 32 32"
        className={svgSizeClass}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Document Page Sheet */}
        <path
          d="M8 3.5h11.2L25.5 9.8V26a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 26V6A2.5 2.5 0 0 1 8 3.5Z"
          fill="currentColor"
          fillOpacity="0.12"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        {/* Folded Corner */}
        <path
          d="M19 3.5V10h6.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Iconic Adobe PDF Trefoil Curve */}
        <path
          d="M15.4 9.2c-1.1 3.5-3.2 6.8-5.7 8.8 3.1-1.1 6.9-1.5 10.6-.8-2.1-1.6-3.9-4.5-4.9-8Z"
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Bottom Solid Crimson PDF Ribbon */}
        <rect
          x="4.5"
          y="19.8"
          width="19"
          height="6.6"
          rx="1.8"
          fill="#DC2626"
          stroke="#FFFFFF"
          strokeWidth="1"
        />
        <text
          x="14"
          y="24.5"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="5.1"
          fontWeight="800"
          fontFamily="JetBrains Mono, Inter, system-ui, sans-serif"
          letterSpacing="0.06em"
        >
          PDF
        </text>
      </svg>
    </div>
  );
};

export interface FileFormatBadgeProps {
  filename?: string | null;
  format?: DocumentFormat;
  className?: string;
}

/**
 * Compact pill badge ("PDF" in crimson or "DOCX" in royal blue)
 * for inline metadata rows next to document IDs and filenames.
 */
export const FileFormatBadge: React.FC<FileFormatBadgeProps> = ({
  filename,
  format,
  className = '',
}) => {
  const resolvedFormat: DocumentFormat = format ?? getDocumentFormat(filename);
  const isDocx = resolvedFormat === 'docx';
  const isBib = resolvedFormat === 'bib';
  const isRis = resolvedFormat === 'ris';

  if (isBib) {
    return (
      <span
        data-testid="file-format-badge-bib"
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-800 shrink-0 select-none ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
        BIB
      </span>
    );
  }

  if (isRis) {
    return (
      <span
        data-testid="file-format-badge-ris"
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/90 dark:text-amber-300 dark:border-amber-800 shrink-0 select-none ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
        RIS
      </span>
    );
  }

  if (isDocx) {
    return (
      <span
        data-testid="file-format-badge-docx"
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] dark:bg-[#172554]/90 dark:text-[#93C5FD] dark:border-[#1E40AF] shrink-0 select-none ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] dark:bg-[#60A5FA]" />
        DOCX
      </span>
    );
  }

  return (
    <span
      data-testid="file-format-badge-pdf"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] dark:bg-[#450A0A]/90 dark:text-[#FCA5A5] dark:border-[#991B1B] shrink-0 select-none ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] dark:bg-[#F87171]" />
      PDF
    </span>
  );
};

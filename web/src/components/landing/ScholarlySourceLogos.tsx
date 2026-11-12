import React from 'react';

export interface ScholarlyLogoProps {
  name: string;
  size?: number;
  className?: string;
}

/**
 * Resolves a scholarly index or bibliographic tool name to its official homepage / project URL.
 */
export function getScholarlySourceUrl(name: string): string | undefined {
  const key = name.toLowerCase();
  if (key.includes('crossref')) return 'https://www.crossref.org';
  if (key.includes('openalex')) return 'https://openalex.org';
  if (key.includes('semantic')) return 'https://www.semanticscholar.org';
  if (key.includes('pubmed') || key.includes('ncbi')) return 'https://pubmed.ncbi.nlm.nih.gov';
  if (key.includes('arxiv')) return 'https://arxiv.org';
  if (key.includes('europe') || key.includes('pmc')) return 'https://europepmc.org';
  if (key.includes('dblp')) return 'https://dblp.org';
  if (key.includes('doaj')) return 'https://doaj.org';
  if (key.includes('orcid')) return 'https://orcid.org';
  if (key.includes('unpaywall') || key.includes('open access')) return 'https://unpaywall.org';
  if (key.includes('datacite')) return 'https://datacite.org';
  if (key.includes('retraction')) return 'https://retractionwatch.com';
  if (key.includes('wayback') || key.includes('archive')) return 'https://web.archive.org';
  if (key.includes('ietf') || key.includes('rfc')) return 'https://www.rfc-editor.org';
  if (key.includes('vn legal') || key.includes('vbpl')) return 'https://vbpl.vn';
  if (key.includes('wikidata')) return 'https://www.wikidata.org';
  if (key.includes('openaire')) return 'https://www.openaire.eu';
  if (key.includes('hugging')) return 'https://huggingface.co';
  if (key.includes('openlibrary')) return 'https://openlibrary.org';
  if (key.includes('acl')) return 'https://aclanthology.org';
  if (key.includes('grobid') || key.includes('tei')) return 'https://grobid.readthedocs.io';
  if (key.includes('sqlite') || key.includes('fts5')) return 'https://www.sqlite.org/fts5.html';
  return undefined;
}

/**
 * Official scholarly index & bibliographic organization logos,
 * adapted into warm editorial monochrome/duotone (`currentColor`) vectors
 * to seamlessly match CITRA's Solva design system in both Light and Dark modes.
 */
export function ScholarlySourceLogo({
  name,
  size = 20,
  className = '',
}: ScholarlyLogoProps): React.ReactElement {
  const key = name.toLowerCase();

  // 1. Crossref — Official interlocking tilted bars (Academicons / Crossref Brand Mark)
  if (key.includes('crossref')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 320 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          d="M 310.362,40 25.168,134.018 217.235,200.002 310.362,169.332 Z"
          fill="currentColor"
        />
        <path
          d="M 9.638,139.129 V 271.099 L 201.672,205.114 Z"
          fill="currentColor"
          fillOpacity="0.52"
        />
        <path
          d="M 217.235,210.226 25.195,276.211 102.738,301.747 294.805,235.79 Z"
          fill="currentColor"
          fillOpacity="0.78"
        />
        <path
          d="M 310.362,240.901 118.296,306.886 310.362,372.871 Z"
          fill="currentColor"
          fillOpacity="0.52"
        />
        <path
          d="M 102.738,311.998 9.638,342.668 V 472 L 294.805,377.983 Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  // 2. OpenAlex — Official OpenAlex trefoil keyhole emblem (Wikimedia Commons / OurResearch)
  if (key.includes('openalex')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 520 488"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M 60.60 472.92 Q 44.31 461.94 39.89 458.09 Q 28.22 447.93 17.66 431.33 Q 9.41 418.37 5.66 402.53 Q 2.49 389.14 1.91 385.50 Q -0.33 371.35 1.97 356.64 Q 2.47 353.49 6.99 335.01 Q 7.31 333.67 8.90 329.03 Q 9.92 326.04 11.17 323.22 Q 14.92 314.76 20.80 306.36 C 28.11 295.93 34.54 288.17 44.59 280.59 Q 54.19 273.35 62.06 268.85 Q 64.95 267.20 71.68 264.39 Q 73.63 263.58 74.14 263.63 Q 86.53 259.60 100.17 256.75 Q 116.24 255.04 128.54 248.31 Q 144.46 239.58 153.08 223.88 Q 166.05 195.09 156.16 170.63 Q 152.69 159.90 151.93 157.79 Q 149.67 149.69 147.26 139.70 Q 143.62 114.01 145.11 105.04 Q 147.16 92.64 150.35 81.07 Q 152.39 73.66 156.14 65.62 Q 158.89 59.71 164.01 52.48 Q 170.55 43.23 173.15 40.14 C 181.01 30.76 191.28 23.41 201.23 16.98 Q 208.92 12.02 221.00 7.86 Q 237.13 3.77 253.51 1.03 Q 265.67 0.41 274.50 1.91 Q 278.68 2.62 295.50 6.78 C 310.80 10.56 324.20 19.38 336.63 29.63 C 346.71 37.95 355.29 49.73 361.92 61.05 Q 366.36 68.64 369.85 80.15 Q 376.98 109.50 375.93 123.57 C 375.24 132.80 372.29 144.14 370.07 152.59 Q 367.84 161.06 362.63 173.60 Q 357.23 189.96 360.19 205.26 Q 363.35 221.56 373.85 233.96 Q 386.08 248.42 405.57 253.89 Q 410.04 255.97 415.33 255.92 Q 426.34 257.95 438.96 261.29 Q 445.80 263.10 452.55 266.14 Q 458.52 268.84 465.04 273.20 C 473.50 278.87 482.52 285.32 489.33 293.42 Q 497.17 302.74 503.59 313.15 Q 509.19 322.23 512.73 334.02 Q 518.52 358.08 518.93 363.84 Q 519.91 377.75 517.13 390.49 Q 514.13 404.26 511.67 411.72 Q 507.96 422.93 501.63 432.39 Q 496.78 439.63 491.92 445.91 Q 488.09 450.85 479.67 458.42 Q 475.48 462.19 461.42 471.56 Q 446.57 478.68 439.79 480.91 Q 425.86 484.31 411.79 486.81 Q 399.03 487.81 389.27 486.09 Q 379.21 484.32 364.00 480.14 Q 356.25 477.30 355.42 476.93 Q 347.32 473.27 339.01 467.50 C 329.25 460.72 321.00 454.24 313.79 444.76 Q 307.98 437.11 305.19 432.82 Q 297.59 421.10 294.24 409.79 Q 292.55 404.07 289.04 388.00 Q 285.69 372.72 288.89 355.02 Q 289.61 351.05 292.94 337.44 Q 295.50 326.96 300.42 317.56 Q 304.45 309.86 305.36 306.64 Q 307.96 297.40 307.88 291.78 Q 307.64 274.75 298.44 262.54 Q 290.27 251.70 278.04 246.72 Q 265.56 241.63 252.34 243.81 Q 238.83 246.05 228.62 254.93 C 217.16 264.90 210.85 280.10 212.37 295.20 Q 213.44 305.81 217.39 312.96 Q 222.57 322.34 225.04 330.48 Q 229.87 346.46 232.04 360.70 Q 232.75 365.36 232.55 375.25 Q 232.42 381.68 230.63 389.66 Q 227.41 404.01 226.09 408.60 Q 222.67 420.46 215.94 430.97 Q 213.46 434.86 206.54 444.29 C 198.88 454.72 189.11 461.95 178.61 469.10 Q 172.45 473.31 164.57 476.91 Q 157.84 479.98 139.97 484.24 Q 123.67 488.13 110.19 486.99 Q 102.63 486.34 94.97 484.51 Q 82.02 481.40 73.70 478.93 L 66.88 476.09 Q 62.37 473.26 60.60 472.92 Z"
        />
      </svg>
    );
  }

  // 3. Semantic Scholar — Official AI2 book-pages & checkmark leaf (Simple Icons / Academicons)
  if (key.includes('semantic')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          d="M24 8.609c-.848.536-1.436.83-2.146 1.245-4.152 2.509-8.15 5.295-11.247 8.981l-1.488 1.817-4.568-7.268c1.021.814 3.564 3.098 4.603 3.599l3.356-2.526c2.336-1.644 8.946-5.226 11.49-5.848Z"
          fill="currentColor"
        />
        <path
          d="M8.046 15.201c.346.277.692.537.969.744.761-3.668.121-7.613-1.886-11.039 3.374-.052 6.731-.087 10.105-.139a14.794 14.794 0 0 1 1.298 5.295c.294-.156.588-.294.883-.433-.104-1.868-.641-3.91-1.662-6.263-4.602-.018-9.188-.018-13.79-.018 2.993 3.547 4.36 7.839 4.083 11.853Z"
          fill="currentColor"
          fillOpacity="0.78"
        />
        <path
          d="M7.423 14.717c.087.086.191.155.277.225-.138-3.409-1.419-6.887-3.824-9.881H1.73c3.098 2.855 4.984 6.299 5.693 9.656Z"
          fill="currentColor"
          fillOpacity="0.58"
        />
        <path
          d="M6.679 14.059c.104.087.208.173.329.277-.9-2.526-2.492-5.018-4.741-7.198H0c2.89 2.076 5.122 4.481 6.679 6.921Z"
          fill="currentColor"
          fillOpacity="0.42"
        />
      </svg>
    );
  }

  // 4. PubMed NCBI — Official NLM PubMed book + "M" emblem (Simple Icons / Academicons)
  if (key.includes('pubmed') || key.includes('ncbi')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M8.23 7.982l.006-1.005C7.846 1.417 5.096 0 5.096 0l.048 2.291C3.73 1.056 2.6 1.444 2.6 1.444l.118 15.307s4.218-1.796 5.428 5.505C10.238 13.535 21.401 24 21.401 24V9S10.52-.18 8.231 7.982zm9.79 9.941l-1.046-5.232-1.904 4.507h-.96l-1.72-4.301-1.046 5.04H9.321l2.093-9.39h.802l2.491 5.543 2.508-5.557h.869l2.075 9.39h-2.138z"
        />
      </svg>
    );
  }

  // 5. arXiv — Official Cornell arXiv intersecting chi chain mark (Simple Icons / Academicons)
  if (key.includes('arxiv')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M3.8423 0a1.0037 1.0037 0 0 0-.922.6078c-.1536.3687-.0438.6275.2938 1.1113l6.9185 8.3597-1.0223 1.1058a1.0393 1.0393 0 0 0 .003 1.4229l1.2292 1.3135-5.4391 6.4444c-.2803.299-.4538.823-.2971 1.1986a1.0253 1.0253 0 0 0 .9585.635.9133.9133 0 0 0 .6891-.3405l5.783-6.126 7.4902 8.0051a.8527.8527 0 0 0 .6835.2597.9575.9575 0 0 0 .8777-.6138c.1577-.377-.017-.7502-.306-1.1407l-7.0518-8.3418 1.0632-1.13a.9626.9626 0 0 0 .0089-1.3165L4.6336.4639s-.3733-.4535-.768-.463zm0 .272h.0166c.2179.0052.4874.2715.5644.3639l.005.006.0052.0055 10.169 10.9905a.6915.6915 0 0 1-.0072.945l-1.0666 1.133-1.4982-1.7724-8.5994-10.39c-.3286-.472-.352-.6183-.2592-.841a.7307.7307 0 0 1 .6704-.4401Zm14.341 1.5701a.877.877 0 0 0-.6554.2418l-5.6962 6.1584 1.6944 1.8319 5.3089-6.5138c.3251-.4335.479-.6603.3247-1.0292a1.1205 1.1205 0 0 0-.9763-.689zm-7.6557 12.2823 1.3186 1.4135-5.7864 6.1295a.6494.6494 0 0 1-.4959.26.7516.7516 0 0 1-.706-.4669c-.1119-.2682.0359-.6864.2442-.9083l.0051-.0055.0047-.0055z"
        />
      </svg>
    );
  }

  // 6. Europe PMC — Official Europe PMC overlapping Venn spheres & bracket mark
  if (key.includes('europe') || key.includes('pmc')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        {/* Top-left green sphere in monochrome */}
        <circle cx="6.2" cy="6.4" r="4.6" fill="currentColor" fillOpacity="0.48" />
        {/* Bottom-left blue sphere in monochrome */}
        <circle cx="8.2" cy="17.4" r="5.0" fill="currentColor" fillOpacity="0.42" />
        {/* Primary right red sphere in monochrome */}
        <circle cx="14.5" cy="10.5" r="7.8" fill="currentColor" fillOpacity="0.82" />
        {/* Satellite node */}
        <circle cx="11.2" cy="2.1" r="1.25" fill="currentColor" fillOpacity="0.35" />
        {/* Signature Europe PMC inner open bracket */}
        <path
          d="M9.5 6.8H4.8V17.6H11.5"
          stroke="var(--solva-bg, #FBFAF6)"
          strokeWidth="1.45"
          strokeLinecap="square"
        />
      </svg>
    );
  }

  // 7. DBLP — Official DBLP interlocking angled pages emblem (Simple Icons / Academicons)
  if (key.includes('dblp')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M3.075.002c-.096.013-.154.092-.094.31L4.97 7.73 3.1 8.6s-.56.26-.4.85l2.45 9.159s.16.59.72.33l6.169-2.869 1.3-.61s.52-.24.42-.79l-.01-.06-1.13-4.22-.658-2.45-.672-2.49v-.04s-.16-.59-.84-1L3.5.141s-.265-.16-.425-.139z"
        />
        <path
          fill="currentColor"
          fillOpacity="0.65"
          d="M18.324 5.03a.724.724 0 0 0-.193.06l-5.602 2.6.862 3.2 1.09 4.08.01.06c.05.47-.411.79-.411.79l-1.88.87.5 1.89.04.1c.07.17.28.6.81.91l6.95 4.269s.68.41.52-.17l-1.981-7.4 1.861-.86s.56-.26.4-.85L18.85 5.42s-.116-.452-.526-.39z"
        />
      </svg>
    );
  }

  // 8. DOAJ — Official Directory of Open Access Journals 3-layered leaf emblem (Wikimedia Commons)
  if (key.includes('doaj')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="85 85 416 360"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          d="m 100,427.401 c 89.676,0 162.372,-72.697 162.372,-162.372 V 102.656 C 172.697,102.656 100,175.353 100,265.029 Z"
          fill="currentColor"
          fillOpacity="0.38"
        />
        <path
          d="m 211.98,427.401 c 89.676,0 162.373,-72.697 162.373,-162.373 V 102.656 c -89.676,0 -162.373,72.696 -162.373,162.372 z"
          fill="currentColor"
          fillOpacity="0.66"
        />
        <path
          d="m 323.961,427.401 c 89.676,0 162.372,-72.697 162.372,-162.373 V 102.656 c -89.676,0 -162.372,72.696 -162.372,162.372 z"
          fill="currentColor"
        />
      </svg>
    );
  }

  // 9. ORCID — Official ORCID iD circle emblem (Simple Icons / Academicons)
  if (key.includes('orcid')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zM7.369 4.378c.525 0 .947.431.947.947s-.422.947-.947.947a.95.95 0 0 1-.947-.947c0-.525.422-.947.947-.947zm-.722 3.038h1.444v10.041H6.647V7.416zm3.562 0h3.9c3.712 0 5.344 2.653 5.344 5.025 0 2.578-2.016 5.025-5.325 5.025h-3.919V7.416zm1.444 1.303v7.444h2.297c3.272 0 4.022-2.484 4.022-3.722 0-2.016-1.284-3.722-4.097-3.722h-2.222z"
        />
      </svg>
    );
  }

  // 10. Unpaywall — Official Open Access / Unpaywall unlocked shackle emblem (Academicons)
  if (key.includes('unpaywall') || key.includes('open access')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 384 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M 192.233,64 C 135.773,64 89.562,110.212 89.562,166.672 v 14.022 h 41.118 v -14.022 c 0,-34.239 27.315,-61.554 61.553,-61.554 34.238,0 61.553,27.315 61.553,61.554 v 56.252 C 235.673,212.101 214.535,205.864 192,205.864 125.38,205.864 70.932,260.311 70.932,326.932 70.932,393.553 125.38,448 192,448 c 66.62,0 121.068,-54.447 121.068,-121.068 0,-23.29 -6.661,-45.088 -18.164,-63.596 V 166.672 C 294.904,110.212 248.693,64 192.233,64 Z M 192,246.982 c 44.398,0 79.95,35.551 79.95,79.95 0,44.398 -35.551,79.95 -79.95,79.95 -44.398,0 -79.95,-35.551 -79.95,-79.95 0,-44.398 35.551,-79.95 79.95,-79.95 z m 0.395,46.393 c -18.735,0 -33.922,15.187 -33.922,33.922 0,18.735 15.187,33.922 33.922,33.922 18.735,0 33.922,-15.188 33.922,-33.922 0,-18.735 -15.188,-33.922 -33.922,-33.922 z"
        />
      </svg>
    );
  }

  // 11. DataCite — Official DataCite intersecting orbital globe mark (Academicons)
  if (key.includes('datacite')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="m 223.326,57.92 c -77.993,3.042 -98.941,133.669 -55.102,240.361 3.45,11.803 7.934,23.432 13.205,34.728 -54.61,13.926 -116.179,21.669 -173.428,21.378 3.38,0.676 6.758,1.357 10.814,2.033 55.348,11.028 119.018,14.147 181.654,10.682 61.853,94.222 175.601,141.207 200.999,-13.389 -0.676,0.676 -2.026,0.671 -4.054,1.347 -32.044,69.595 -89.288,55.357 -133.59,6.233 116.078,-14.943 216.774,-52.363 237.021,-103.576 27.043,-70.311 -123.71,-120.343 -300.165,-114.258 -0.603,0 -1.206,0.022 -1.809,0.026 7.899,-51.908 40.112,-83.115 102.219,-54.785 C 271.477,66.219 245.164,57.067 223.326,57.919 Z m -24.706,87.176 c 90.64,10.741 169.414,47.364 136.587,103.827 -15.916,27.202 -53.836,50.521 -102.361,68.294 -3.254,-5.922 -6.358,-11.994 -9.19,-18.262 -22.569,-50.085 -32.207,-109.316 -25.036,-153.859 z"
        />
      </svg>
    );
  }

  // 12. GROBID TEI — Official Text Encoding Initiative (TEI 2024) corner-bracket emblem
  if (key.includes('grobid') || key.includes('tei')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 156 156"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${className}`}
        aria-hidden="true"
      >
        {/* Top-Right & Bottom-Left TEI Corner Brackets */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M58 0H156V98H144V12H58V0ZM0 58H12V144H98V156H0V58Z"
          fill="currentColor"
          fillOpacity="0.58"
        />
        {/* Inner Square with Cutout TEI Monogram */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M18 18H138V138H18V18ZM27 51.73H68.71V59.5H52.1V103.36H43.1V59.5H27V51.73ZM74.33 51.73H106.05V59.5H83.1V73.28H104.31V80.8H83.1V95.6H107.27V103.36H74.33V51.73ZM112.1 51.73H121.1V103.37H112.1V51.73Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  // Fallback for Local SQLite FTS5 / Regex Cross-Validator in Debugger widgets
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </svg>
  );
}

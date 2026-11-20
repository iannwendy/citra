import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  X,
  Loader2,
  ImageIcon,
  Move,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  ImagePlus,
} from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const OUTPUT_SIZE = 512;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 3.0;
const CROP_CACHE_KEY = 'citra_avatar_crop_cache_v1';

const SIZE_PX: Record<'sm' | 'md' | 'lg', number> = {
  sm: 64,
  md: 96,
  lg: 128,
};

interface AvatarUploadProps {
  currentAvatarUrl: string | null;
  onSuccess: (user: import('@/api/client').User) => void;
  size?: 'sm' | 'md' | 'lg';
}

interface CropCachePayload {
  baseAvatarPath: string;
  sourceDataUrl: string;
  mimeType: string;
  offset: { x: number; y: number };
  zoom: number;
}

function stripQuery(url: string | null): string {
  if (!url) return '';
  return url.split('?', 1)[0];
}

function readCropCache(currentAvatarUrl: string | null): CropCachePayload | null {
  if (!currentAvatarUrl) return null;
  try {
    const raw = localStorage.getItem(CROP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CropCachePayload;
    if (
      parsed &&
      parsed.sourceDataUrl &&
      parsed.baseAvatarPath === stripQuery(currentAvatarUrl)
    ) {
      return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function writeCropCache(payload: CropCachePayload): void {
  try {
    localStorage.setItem(CROP_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function AvatarUpload({
  currentAvatarUrl,
  onSuccess,
  size = 'md',
}: AvatarUploadProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceMime, setSourceMime] = useState<string>('image/jpeg');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [draggingFile, setDraggingFile] = useState(false);

  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startOffset: { x: 0, y: 0 },
    moved: false,
  });

  const viewportSize = SIZE_PX[size];

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-32 h-32',
  };

  const baseCoverScale =
    naturalSize.width > 0 && naturalSize.height > 0
      ? Math.max(viewportSize / naturalSize.width, viewportSize / naturalSize.height)
      : 1;

  const renderedW =
    naturalSize.width > 0
      ? naturalSize.width * baseCoverScale * zoom
      : viewportSize * zoom;
  const renderedH =
    naturalSize.height > 0
      ? naturalSize.height * baseCoverScale * zoom
      : viewportSize * zoom;

  const clampOffset = useCallback(
    (
      next: { x: number; y: number },
      targetZoom = zoom,
      nat = naturalSize
    ): { x: number; y: number } => {
      const scale =
        nat.width > 0 && nat.height > 0
          ? Math.max(viewportSize / nat.width, viewportSize / nat.height)
          : 1;
      const rw =
        nat.width > 0 ? nat.width * scale * targetZoom : viewportSize * targetZoom;
      const rh =
        nat.height > 0 ? nat.height * scale * targetZoom : viewportSize * targetZoom;

      // Allow full image overflow panning plus slack margin so even 1:1 square
      // images or tightly cropped portraits can be freely aligned by the user.
      const slack = viewportSize * 0.35;
      const maxX = Math.max(0, (rw - viewportSize) / 2) + slack;
      const maxY = Math.max(0, (rh - viewportSize) / 2) + slack;

      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [viewportSize, zoom, naturalSize]
  );

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth || viewportSize;
    const nh = img.naturalHeight || viewportSize;
    setNaturalSize({ width: nw, height: nh });

    // Sample corner pixel color for seamless background fill when panning near edges
    try {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 1;
      sampleCanvas.height = 1;
      const sctx = sampleCanvas.getContext('2d');
      if (sctx) {
        sctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
        const [r, g, b, a] = sctx.getImageData(0, 0, 1, 1).data;
        if (a > 128) {
          setBgColor(`rgb(${r}, ${g}, ${b})`);
        } else {
          setBgColor('#ffffff');
        }
      }
    } catch {
      setBgColor('#ffffff');
    }
  };

  const handleFileSelect = (file: File) => {
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Only JPG, PNG, and WEBP images are allowed.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File size must be under 2MB.');
      return;
    }
    setSelectedFile(file);
    setSourceMime(file.type || 'image/jpeg');
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    setIsAdjusting(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const enterAdjustExisting = useCallback(() => {
    if (!currentAvatarUrl) return;
    setError('');
    const cached = readCropCache(currentAvatarUrl);
    if (cached) {
      setPreview(cached.sourceDataUrl);
      setSourceMime(cached.mimeType || 'image/jpeg');
      setOffset(cached.offset);
      setZoom(cached.zoom);
      dragStateRef.current.startOffset = { ...cached.offset };
    } else {
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      dragStateRef.current.startOffset = { x: 0, y: 0 };
    }
    setIsAdjusting(true);
  }, [currentAvatarUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggingFile(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleZoomChange = useCallback(
    (nextZoom: number) => {
      const clampedZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Number(nextZoom.toFixed(2)))
      );
      setZoom(clampedZoom);
      setOffset((prev) => clampOffset(prev, clampedZoom));
    },
    [clampOffset]
  );

  // Attach wheel listener on viewport when adjusting so scrolling zooms smoothly
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !isAdjusting) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      handleZoomChange(zoom + delta);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isAdjusting, zoom, handleZoomChange]);

  const startDrag = useCallback(
    (clientX: number, clientY: number) => {
      const displayUrl = preview || currentAvatarUrl;
      if (!displayUrl || uploading) return;

      dragStateRef.current = {
        active: true,
        startX: clientX,
        startY: clientY,
        startOffset: { ...offset },
        moved: false,
      };
    },
    [preview, currentAvatarUrl, uploading, offset]
  );

  const moveDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStateRef.current.active) return;

      const dx = clientX - dragStateRef.current.startX;
      const dy = clientY - dragStateRef.current.startY;

      if (!dragStateRef.current.moved && Math.hypot(dx, dy) > 3) {
        dragStateRef.current.moved = true;
        setIsPanning(true);
        if (!isAdjusting && currentAvatarUrl) {
          const cached = readCropCache(currentAvatarUrl);
          if (cached) {
            setPreview(cached.sourceDataUrl);
            setSourceMime(cached.mimeType || 'image/jpeg');
            setZoom(cached.zoom);
            dragStateRef.current.startOffset = { ...cached.offset };
          }
          setIsAdjusting(true);
        }
      }

      if (dragStateRef.current.moved) {
        setOffset(
          clampOffset({
            x: dragStateRef.current.startOffset.x + dx,
            y: dragStateRef.current.startOffset.y + dy,
          })
        );
      }
    },
    [isAdjusting, currentAvatarUrl, clampOffset]
  );

  const endDrag = useCallback(() => {
    if (!dragStateRef.current.active) return;
    const wasMoved = dragStateRef.current.moved;
    dragStateRef.current.active = false;
    setIsPanning(false);

    // If user clicked without dragging while not in adjust mode, open file picker
    if (!wasMoved && !isAdjusting) {
      inputRef.current?.click();
    }
  }, [isAdjusting]);

  // Global window listeners so dragging stays smooth even when cursor leaves the circle
  useEffect(() => {
    const onWinMouseMove = (e: MouseEvent) => {
      if (dragStateRef.current.active) {
        moveDrag(e.clientX, e.clientY);
      }
    };
    const onWinMouseUp = () => {
      if (dragStateRef.current.active) {
        endDrag();
      }
    };
    const onWinTouchMove = (e: TouchEvent) => {
      if (dragStateRef.current.active && e.touches[0]) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onWinTouchEnd = () => {
      if (dragStateRef.current.active) {
        endDrag();
      }
    };

    window.addEventListener('mousemove', onWinMouseMove);
    window.addEventListener('mouseup', onWinMouseUp);
    window.addEventListener('touchmove', onWinTouchMove, { passive: true });
    window.addEventListener('touchend', onWinTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onWinMouseMove);
      window.removeEventListener('mouseup', onWinMouseUp);
      window.removeEventListener('touchmove', onWinTouchMove);
      window.removeEventListener('touchend', onWinTouchEnd);
    };
  }, [moveDrag, endDrag]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!e.touches[0]) return;
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
  };

  const generateCroppedFile = async (): Promise<File> => {
    const activeSrc = preview || currentAvatarUrl;
    if (!activeSrc) {
      if (selectedFile) return selectedFile;
      throw new Error('No image selected');
    }

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (selectedFile) return selectedFile;
      throw new Error('Canvas not supported');
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      if (!activeSrc.startsWith('data:')) {
        image.crossOrigin = 'anonymous';
      }
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load image for cropping'));
      image.src = activeSrc;
    });

    const nw = img.naturalWidth || viewportSize;
    const nh = img.naturalHeight || viewportSize;
    const scale = Math.max(viewportSize / nw, viewportSize / nh);
    const rw = nw * scale * zoom;
    const rh = nh * scale * zoom;

    const ratio = OUTPUT_SIZE / viewportSize;
    const drawW = rw * ratio;
    const drawH = rh * ratio;
    const drawX = (OUTPUT_SIZE - drawW) / 2 + offset.x * ratio;
    const drawY = (OUTPUT_SIZE - drawH) / 2 + offset.y * ratio;

    ctx.fillStyle = bgColor || '#ffffff';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    const outMime = ACCEPTED_TYPES.includes(sourceMime) ? sourceMime : 'image/jpeg';
    const ext =
      outMime === 'image/png' ? 'png' : outMime === 'image/webp' ? 'webp' : 'jpg';

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outMime, 0.92)
    );

    if (!blob) {
      if (selectedFile) return selectedFile;
      throw new Error('Failed to encode cropped avatar');
    }

    return new File([blob], `avatar-cropped.${ext}`, { type: outMime });
  };

  const handleUpload = async () => {
    if (!selectedFile && !isAdjusting) return;
    setUploading(true);
    setError('');
    try {
      const sourceForCache = preview;
      const savedOffset = { ...offset };
      const savedZoom = zoom;

      let fileToUpload: File;
      try {
        fileToUpload = await generateCroppedFile();
      } catch {
        if (selectedFile) {
          fileToUpload = selectedFile;
        } else {
          throw new Error('Could not process image');
        }
      }

      const user = await api.uploadMyAvatar(fileToUpload);

      if (sourceForCache && user.avatar_url) {
        writeCropCache({
          baseAvatarPath: stripQuery(user.avatar_url),
          sourceDataUrl: sourceForCache,
          mimeType: sourceMime,
          offset: savedOffset,
          zoom: savedZoom,
        });
      }

      onSuccess(user);
      setSelectedFile(null);
      setPreview(null);
      setIsAdjusting(false);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    setPreview(null);
    setIsAdjusting(false);
    setIsPanning(false);
    setOffset({ x: 0, y: 0 });
    setZoom(1);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleResetPosition = () => {
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  };

  const displayUrl = preview || currentAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Interactive circular avatar frame */}
      <div
        ref={viewportRef}
        data-testid="avatar-crop-viewport"
        style={displayUrl ? { backgroundColor: bgColor } : undefined}
        className={`relative ${sizeClasses[size]} rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 border-2 border-dashed flex items-center justify-center select-none touch-none transition-colors group ${
          draggingFile
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
            : isAdjusting
              ? 'border-indigo-500 ring-4 ring-indigo-500/15 cursor-grab active:cursor-grabbing'
              : displayUrl
                ? 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 cursor-grab active:cursor-grabbing'
                : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 cursor-pointer'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDraggingFile(true);
        }}
        onDragLeave={() => setDraggingFile(false)}
        onDrop={handleDrop}
        onMouseDown={displayUrl ? handleMouseDown : undefined}
        onTouchStart={displayUrl ? handleTouchStart : undefined}
        onClick={!displayUrl ? () => inputRef.current?.click() : undefined}
      >
        {displayUrl ? (
          <>
            {isAdjusting ? (
              <img
                ref={imgRef}
                src={displayUrl}
                alt="Avatar preview"
                referrerPolicy="no-referrer"
                crossOrigin={displayUrl.startsWith('data:') ? undefined : 'anonymous'}
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: `${renderedW}px`,
                  height: `${renderedH}px`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  transform: `translate3d(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px), 0)`,
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={displayUrl}
                alt="Avatar preview"
                referrerPolicy="no-referrer"
                crossOrigin={displayUrl.startsWith('data:') ? undefined : 'anonymous'}
                draggable={false}
                onLoad={handleImageLoad}
                className="w-full h-full object-cover pointer-events-none select-none"
              />
            )}

            {/* Alignment rule-of-thirds grid overlay when adjusting/dragging */}
            {isAdjusting && (
              <div
                className={`absolute inset-0 pointer-events-none transition-opacity duration-150 ${
                  isPanning ? 'opacity-90' : 'opacity-40 group-hover:opacity-75'
                }`}
              >
                <div className="w-full h-full grid grid-cols-3 grid-rows-3 drop-shadow-[0_0_1px_rgba(0,0,0,0.4)]">
                  <div className="border-r border-b border-white/65" />
                  <div className="border-r border-b border-white/65" />
                  <div className="border-b border-white/65" />
                  <div className="border-r border-b border-white/65" />
                  <div className="border-r border-b border-white/65" />
                  <div className="border-b border-white/65" />
                  <div className="border-r border-white/65" />
                  <div className="border-r border-white/65" />
                  <div />
                </div>
              </div>
            )}

            {/* Subtle hover badge when not yet in adjust mode */}
            {!isAdjusting && (
              <div className="absolute inset-x-0 bottom-0 py-1 bg-slate-900/60 backdrop-blur-[2px] text-white text-[10px] font-medium flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <Move className="h-2.5 w-2.5" />
                <span>{t('profile.adjustFrame')}</span>
              </div>
            )}
          </>
        ) : (
          <ImageIcon className="h-8 w-8 text-slate-400" />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleInputChange}
        className="hidden"
      />

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>
      )}

      {isAdjusting ? (
        <div className="flex flex-col items-center gap-2.5 w-full">
          {/* Drag hint */}
          <p className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 flex items-center gap-1 text-center">
            <Move className="h-3 w-3 shrink-0" />
            <span>{t('profile.dragToAdjust')}</span>
          </p>

          {/* Zoom slider + Reset button */}
          <div className="flex items-center gap-1.5 w-full max-w-[11.5rem] px-1">
            <button
              type="button"
              onClick={() => handleZoomChange(zoom - 0.1)}
              disabled={uploading || zoom <= MIN_ZOOM}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 disabled:opacity-40 transition-colors"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.02}
              value={zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              disabled={uploading}
              aria-label="Zoom"
              data-testid="avatar-zoom-slider"
              className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <button
              type="button"
              onClick={() => handleZoomChange(zoom + 0.1)}
              disabled={uploading || zoom >= MAX_ZOOM}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 disabled:opacity-40 transition-colors"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetPosition}
              disabled={uploading || (offset.x === 0 && offset.y === 0 && zoom === 1)}
              className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 disabled:opacity-40 transition-colors"
              title={t('profile.resetPosition')}
              aria-label={t('profile.resetPosition')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {selectedFile && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[10rem]">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              disabled={uploading}
              className="text-xs py-1 px-2.5 h-8"
            >
              <X className="h-3 w-3" />
              {t('common.cancel')}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              disabled={uploading}
              className="text-xs py-1 px-2.5 h-8"
              title={t('profile.changePhoto')}
            >
              <ImagePlus className="h-3 w-3" />
              {t('profile.changePhoto')}
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleUpload();
              }}
              disabled={uploading}
              data-testid="avatar-save-btn"
              className="text-xs py-1 px-3 h-8"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t('upload.uploading')}
                </>
              ) : (
                <>
                  {selectedFile ? (
                    <Upload className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  {selectedFile ? t('common.upload') : t('profile.saveAvatar')}
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors cursor-pointer text-center"
          >
            {t('profile.clickOrDrag')}
          </button>

          {currentAvatarUrl && (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={enterAdjustExisting}
                data-testid="avatar-adjust-btn"
                className="text-[11px] py-0.5 px-2.5 h-7 gap-1 rounded-lg"
              >
                <Move className="h-3 w-3" />
                {t('profile.adjustFrame')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="text-[11px] py-0.5 px-2.5 h-7 gap-1 rounded-lg"
              >
                <ImagePlus className="h-3 w-3" />
                {t('profile.changePhoto')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

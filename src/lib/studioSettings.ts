import type {
  GalleryImage,
  ShareBackgroundImageSourceType,
  StudioSettings,
} from '../types';
import {
  BUSINESS_END_TIME,
  BUSINESS_START_TIME,
  SHARE_SLOT_DURATION_MINUTES,
  getInvalidShareSlotTimes,
  getTimeValueMinutes,
  isValidTimeValue,
  normalizeShareSlotTimes,
  type AvailabilityWindow,
} from './availability';

export const DEFAULT_GALLERY_IMAGES: GalleryImage[] = [
  { src: 'https://picsum.photos/seed/nails1/400/500', alt: 'Manicura' },
  { src: 'https://picsum.photos/seed/lashes1/400/400', alt: 'Pestanas' },
  { src: 'https://picsum.photos/seed/facial1/400/600', alt: 'Facial' },
  { src: 'https://picsum.photos/seed/spa1/400/400', alt: 'Spa' },
];

export const DEFAULT_SHARE_BACKGROUND_OVERLAY_OPACITY = 30;
export const MAX_SHARE_BACKGROUND_OVERLAY_OPACITY = 70;
// Legacy Firestore rules only allow galleryImages for share-only settings.
const SHARE_SETTINGS_MARKER_ALT = '__mini_milagros_share_settings_v1__';
const SHARE_SETTINGS_MARKER_SRC_PREFIX = 'data:application/json,';

const sanitizeGalleryImages = (galleryImages: StudioSettings['galleryImages']) => {
  const normalizedGallery = (galleryImages ?? [])
    .map((img) => ({ src: (img?.src ?? '').trim(), alt: (img?.alt ?? '').trim() || 'Trabajo' }))
    .filter((img) => img.src.length > 0 && img.alt !== SHARE_SETTINGS_MARKER_ALT);

  return normalizedGallery.length > 0 ? normalizedGallery : DEFAULT_GALLERY_IMAGES;
};

const isShareBackgroundSourceType = (
  value: unknown,
): value is ShareBackgroundImageSourceType => (
  value === 'library' || value === 'url' || value === 'upload'
);

const getCompatShareSettings = (
  galleryImages: StudioSettings['galleryImages'],
): Partial<StudioSettings> => {
  const marker = (galleryImages ?? []).find((img) => img?.alt === SHARE_SETTINGS_MARKER_ALT);
  const src = marker?.src?.trim() ?? '';

  if (!src.startsWith(SHARE_SETTINGS_MARKER_SRC_PREFIX)) {
    return {};
  }

  try {
    return JSON.parse(decodeURIComponent(src.slice(SHARE_SETTINGS_MARKER_SRC_PREFIX.length))) as Partial<StudioSettings>;
  } catch {
    return {};
  }
};

const buildShareSettingsMarker = (source: StudioSettings): GalleryImage => {
  const normalized = normalizeStudioSettings(source);
  const payload: Partial<StudioSettings> = {
    availabilityStartTime: normalized.availabilityStartTime,
    availabilityEndTime: normalized.availabilityEndTime,
    shareBackgroundOverlayOpacity: normalized.shareBackgroundOverlayOpacity,
  };

  if (normalized.shareBackgroundImageUrl) {
    payload.shareBackgroundImageUrl = normalized.shareBackgroundImageUrl;
  }

  if (normalized.shareBackgroundImageSourceType) {
    payload.shareBackgroundImageSourceType = normalized.shareBackgroundImageSourceType;
  }

  if (normalized.shareBackgroundImageStoragePath) {
    payload.shareBackgroundImageStoragePath = normalized.shareBackgroundImageStoragePath;
  }

  return {
    src: `${SHARE_SETTINGS_MARKER_SRC_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`,
    alt: SHARE_SETTINGS_MARKER_ALT,
  };
};

export const formatShareTimeLabel = (time: string) => {
  const [hours, minutes] = time.split(':');
  return minutes === '00' ? `${hours}hs` : `${hours}:${minutes}hs`;
};

export const getAvailabilityWindowValidationMessage = (
  startTime: unknown,
  endTime: unknown,
) => {
  if (!isValidTimeValue(startTime) || !isValidTimeValue(endTime)) {
    return 'Elegi horarios validos para inicio y cierre.';
  }

  if (getTimeValueMinutes(startTime) >= getTimeValueMinutes(endTime)) {
    return 'El horario de inicio debe ser anterior al horario de cierre.';
  }

  return '';
};

export const normalizeShareBackgroundOverlayOpacity = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SHARE_BACKGROUND_OVERLAY_OPACITY;
  }

  const rounded = Math.round(parsed / 5) * 5;
  return Math.min(MAX_SHARE_BACKGROUND_OVERLAY_OPACITY, Math.max(0, rounded));
};

export const normalizeStudioSettings = (
  source?: Partial<StudioSettings> | null,
): StudioSettings => {
  const compatShareSettings = getCompatShareSettings(source?.galleryImages);
  const depositAmount = Number.isFinite(source?.depositAmount) && Number(source?.depositAmount) >= 0
    ? Number(source?.depositAmount)
    : 0;

  const availabilityStartTimeSource = source?.availabilityStartTime ?? compatShareSettings.availabilityStartTime;
  const availabilityEndTimeSource = source?.availabilityEndTime ?? compatShareSettings.availabilityEndTime;
  const availabilityStartTime = isValidTimeValue(availabilityStartTimeSource)
    ? availabilityStartTimeSource
    : BUSINESS_START_TIME;
  const availabilityEndTime = isValidTimeValue(availabilityEndTimeSource)
    ? availabilityEndTimeSource
    : BUSINESS_END_TIME;
  const availabilityWindowIsValid = !getAvailabilityWindowValidationMessage(
    availabilityStartTime,
    availabilityEndTime,
  );

  const shareBackgroundImageUrlSource = source?.shareBackgroundImageUrl ?? compatShareSettings.shareBackgroundImageUrl;
  const shareBackgroundImageSourceTypeSource = source?.shareBackgroundImageSourceType ?? compatShareSettings.shareBackgroundImageSourceType;
  const shareBackgroundImageStoragePathSource = source?.shareBackgroundImageStoragePath ?? compatShareSettings.shareBackgroundImageStoragePath;
  const shareBackgroundOverlayOpacitySource = source?.shareBackgroundOverlayOpacity ?? compatShareSettings.shareBackgroundOverlayOpacity;
  const shareBackgroundImageUrl = typeof shareBackgroundImageUrlSource === 'string'
    ? shareBackgroundImageUrlSource.trim()
    : '';
  const shareBackgroundImageSourceType = isShareBackgroundSourceType(shareBackgroundImageSourceTypeSource)
    && shareBackgroundImageUrl
    ? shareBackgroundImageSourceTypeSource
    : undefined;
  const shareBackgroundImageStoragePath = typeof shareBackgroundImageStoragePathSource === 'string'
    ? shareBackgroundImageStoragePathSource.trim()
    : '';

  return {
    depositAmount,
    galleryImages: sanitizeGalleryImages(source?.galleryImages),
    shareSlotTimes: normalizeShareSlotTimes(source?.shareSlotTimes),
    availabilityStartTime: availabilityWindowIsValid ? availabilityStartTime : BUSINESS_START_TIME,
    availabilityEndTime: availabilityWindowIsValid ? availabilityEndTime : BUSINESS_END_TIME,
    shareBackgroundImageUrl,
    shareBackgroundImageSourceType,
    shareBackgroundImageStoragePath,
    shareBackgroundOverlayOpacity: normalizeShareBackgroundOverlayOpacity(
      shareBackgroundOverlayOpacitySource,
    ),
    updatedAt: typeof source?.updatedAt === 'string'
      ? source.updatedAt
      : new Date().toISOString(),
  };
};

export const getAvailabilityWindow = (
  source?: Partial<StudioSettings> | null,
): AvailabilityWindow => {
  const normalized = normalizeStudioSettings(source);

  return {
    startTime: normalized.availabilityStartTime || BUSINESS_START_TIME,
    endTime: normalized.availabilityEndTime || BUSINESS_END_TIME,
  };
};

export const buildSettingsPayload = (source: StudioSettings): StudioSettings => {
  const normalized = normalizeStudioSettings(source);
  const payload: StudioSettings = {
    depositAmount: normalized.depositAmount,
    galleryImages: normalized.galleryImages,
    shareSlotTimes: normalized.shareSlotTimes,
    availabilityStartTime: normalized.availabilityStartTime,
    availabilityEndTime: normalized.availabilityEndTime,
    shareBackgroundOverlayOpacity: normalized.shareBackgroundOverlayOpacity,
    updatedAt: new Date().toISOString(),
  };

  if (normalized.shareBackgroundImageUrl) {
    payload.shareBackgroundImageUrl = normalized.shareBackgroundImageUrl;
  }

  if (normalized.shareBackgroundImageSourceType) {
    payload.shareBackgroundImageSourceType = normalized.shareBackgroundImageSourceType;
  }

  if (normalized.shareBackgroundImageStoragePath) {
    payload.shareBackgroundImageStoragePath = normalized.shareBackgroundImageStoragePath;
  }

  return payload;
};

export const buildShareSettingsCompatPayload = (
  source: StudioSettings,
): Pick<StudioSettings, 'depositAmount' | 'galleryImages' | 'shareSlotTimes' | 'updatedAt'> => {
  const normalized = normalizeStudioSettings(source);
  const galleryImages = sanitizeGalleryImages(normalized.galleryImages)
    .slice(0, 19);

  return {
    depositAmount: normalized.depositAmount,
    galleryImages: [...galleryImages, buildShareSettingsMarker(normalized)],
    shareSlotTimes: normalized.shareSlotTimes,
    updatedAt: new Date().toISOString(),
  };
};

export const getShareSettingsValidationMessage = (
  source?: Partial<StudioSettings> | null,
) => {
  const startTime = typeof source?.availabilityStartTime === 'string'
    ? source.availabilityStartTime
    : BUSINESS_START_TIME;
  const endTime = typeof source?.availabilityEndTime === 'string'
    ? source.availabilityEndTime
    : BUSINESS_END_TIME;
  const windowError = getAvailabilityWindowValidationMessage(
    startTime,
    endTime,
  );

  if (windowError) {
    return windowError;
  }

  const normalized = normalizeStudioSettings({
    ...source,
    availabilityStartTime: startTime,
    availabilityEndTime: endTime,
  });
  const invalidSlotTimes = getInvalidShareSlotTimes(
    normalized.shareSlotTimes,
    SHARE_SLOT_DURATION_MINUTES,
    {
      startTime,
      endTime,
    },
  );

  if (invalidSlotTimes.length === 0) {
    return '';
  }

  return `Estos horarios quedan fuera de la disponibilidad real: ${invalidSlotTimes.map(formatShareTimeLabel).join(', ')}. Si queres ofrecer 20hs en una placa de 30 min, el cierre debe ser al menos 20:30.`;
};

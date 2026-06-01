import { useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek, subWeeks } from 'date-fns';
import { es } from 'date-fns/locale';
import type {
  Appointment,
  GalleryImage,
  Service,
  ShareBackgroundImageSourceType,
} from '../types';
import {
  buildShareWeekAvailability,
  isValidTimeValue,
  MAX_SHARE_SLOT_TIMES,
  normalizeShareSlotTimes,
  SHARE_SLOT_DURATION_MINUTES,
  SHARE_SLOT_TIMES,
  type AvailabilityWindow,
  type ShareSlotStatus,
} from '../lib/availability';
import {
  DEFAULT_SHARE_BACKGROUND_OVERLAY_OPACITY,
  MAX_SHARE_BACKGROUND_OVERLAY_OPACITY,
  formatShareTimeLabel,
  getAvailabilityWindow,
  normalizeShareBackgroundOverlayOpacity,
} from '../lib/studioSettings';

type ShareWeekPreviewProps = {
  services: Service[];
  appointments: Appointment[];
  galleryImages?: GalleryImage[];
  slotTimes?: string[];
  availabilityStartTime?: string;
  availabilityEndTime?: string;
  shareBackgroundImageUrl?: string;
  shareBackgroundImageSourceType?: ShareBackgroundImageSourceType;
  shareBackgroundOverlayOpacity?: number;
  onSlotTimesChange: (slotTimes: string[]) => void;
  onAvailabilityWindowChange: (window: AvailabilityWindow) => void;
  onShareBackgroundImageChange: (nextBackground: {
    imageUrl: string;
    sourceType: ShareBackgroundImageSourceType;
    storagePath?: string;
  }) => void;
  onShareBackgroundOverlayOpacityChange: (opacity: number) => void;
  onShareBackgroundUpload: (file: File | null) => void | Promise<void>;
  uploadingBackgroundImage?: boolean;
  onSaveShareSettings: () => void | Promise<void>;
  savingShareSettings?: boolean;
  shareSettingsSaveNotice?: string;
  shareSettingsSaveError?: string;
  shareSettingsValidationError?: string;
};

type BackgroundChoice = {
  src: string;
  label: string;
  caption: string;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const formatWeekRange = (weekStart: Date) => {
  const weekEnd = addDays(weekStart, 5);

  const sameMonth = format(weekStart, 'MM-yyyy') === format(weekEnd, 'MM-yyyy');
  if (sameMonth) {
    return `Del ${format(weekStart, 'd')} al ${format(weekEnd, "d 'de' MMMM", { locale: es })}`;
  }

  return `Del ${format(weekStart, "d 'de' MMMM", { locale: es })} al ${format(weekEnd, "d 'de' MMMM", { locale: es })}`;
};

const getBackgroundImage = (
  explicitBackgroundImageUrl: string | undefined,
  services: Service[],
  galleryImages: GalleryImage[] | undefined,
) => (
  explicitBackgroundImageUrl?.trim() ||
  services.find((service) => service.isActive && service.imageUrl?.trim())?.imageUrl?.trim() ||
  galleryImages?.find((image) => image.src.trim())?.src.trim() ||
  '/mini-milagros-watermark.webp'
);

const getSlotClassName = (status: ShareSlotStatus) => (
  status === 'free'
    ? 'text-white'
    : status === 'booked'
      ? 'text-white/95'
      : 'text-white/45'
);

const shouldRenderBookedStrike = (status: ShareSlotStatus) => status === 'booked';

const getBackgroundSourceLabel = (sourceType?: ShareBackgroundImageSourceType) => {
  if (sourceType === 'library') return 'Biblioteca';
  if (sourceType === 'upload') return 'Subida';
  if (sourceType === 'url') return 'Link';
  return 'Automatica';
};

export default function ShareWeekPreview({
  services,
  appointments,
  galleryImages,
  slotTimes,
  availabilityStartTime,
  availabilityEndTime,
  shareBackgroundImageUrl,
  shareBackgroundImageSourceType,
  shareBackgroundOverlayOpacity,
  onSlotTimesChange,
  onAvailabilityWindowChange,
  onShareBackgroundImageChange,
  onShareBackgroundOverlayOpacityChange,
  onShareBackgroundUpload,
  uploadingBackgroundImage = false,
  onSaveShareSettings,
  savingShareSettings = false,
  shareSettingsSaveNotice = '',
  shareSettingsSaveError = '',
  shareSettingsValidationError = '',
}: ShareWeekPreviewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [newSlotTime, setNewSlotTime] = useState('');
  const [slotTimeInputError, setSlotTimeInputError] = useState('');

  const normalizedSlotTimes = useMemo(() => normalizeShareSlotTimes(slotTimes), [slotTimes]);
  const hasManySlotTimes = normalizedSlotTimes.length > 6;
  const availabilityWindow = useMemo(
    () => getAvailabilityWindow({ availabilityStartTime, availabilityEndTime }),
    [availabilityEndTime, availabilityStartTime],
  );
  const overlayOpacity = normalizeShareBackgroundOverlayOpacity(
    shareBackgroundOverlayOpacity ?? DEFAULT_SHARE_BACKGROUND_OVERLAY_OPACITY,
  );
  const backgroundImage = getBackgroundImage(shareBackgroundImageUrl, services, galleryImages);

  const backgroundChoices = useMemo(() => {
    const choices = new Map<string, BackgroundChoice>();

    services.forEach((service) => {
      const src = service.imageUrl?.trim();
      if (!service.isActive || !src || choices.has(src)) return;

      choices.set(src, {
        src,
        label: service.name,
        caption: 'Servicio activo',
      });
    });

    (galleryImages ?? []).forEach((image, index) => {
      const src = image.src.trim();
      if (!src || choices.has(src)) return;

      choices.set(src, {
        src,
        label: image.alt.trim() || `Trabajo ${index + 1}`,
        caption: 'Galeria',
      });
    });

    return Array.from(choices.values());
  }, [galleryImages, services]);

  const weekAvailability = useMemo(
    () => buildShareWeekAvailability(
      weekStart,
      SHARE_SLOT_DURATION_MINUTES,
      appointments,
      normalizedSlotTimes,
      availabilityWindow,
    ),
    [appointments, availabilityWindow, normalizedSlotTimes, weekStart],
  );

  const updateSlotTimes = (nextSlotTimes: string[]) => {
    setSlotTimeInputError('');
    onSlotTimesChange(normalizeShareSlotTimes(nextSlotTimes));
  };

  const addSlotTime = () => {
    if (!isValidTimeValue(newSlotTime)) {
      setSlotTimeInputError('Elegi un horario valido.');
      return;
    }

    if (normalizedSlotTimes.includes(newSlotTime)) {
      setSlotTimeInputError('Ese horario ya esta.');
      return;
    }

    if (normalizedSlotTimes.length >= MAX_SHARE_SLOT_TIMES) {
      setSlotTimeInputError(`Maximo ${MAX_SHARE_SLOT_TIMES} horarios.`);
      return;
    }

    updateSlotTimes([...normalizedSlotTimes, newSlotTime]);
    setNewSlotTime('');
  };

  const removeSlotTime = (time: string) => {
    if (normalizedSlotTimes.length <= 1) {
      setSlotTimeInputError('Deja al menos un horario.');
      return;
    }

    updateSlotTimes(normalizedSlotTimes.filter((slotTime) => slotTime !== time));
  };

  const resetSlotTimes = () => {
    setNewSlotTime('');
    updateSlotTimes([...SHARE_SLOT_TIMES]);
  };

  const saveShareSettings = () => {
    if (shareSettingsValidationError) return;
    void onSaveShareSettings();
  };

  const backgroundSourceLabel = getBackgroundSourceLabel(shareBackgroundImageSourceType);
  const gradientTopOpacity = Math.min(0.85, overlayOpacity / 100 + 0.12);
  const gradientMiddleOpacity = Math.max(0.08, overlayOpacity / 100 - 0.1);
  const gradientBottomOpacity = Math.min(0.78, overlayOpacity / 100 + 0.08);

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-[16px] border border-primary-container bg-background p-5 shadow-sm">
        <div>
          <h2 className="font-serif text-[18px] text-primary">Compartir turnos</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Configura la disponibilidad real, la placa y el fondo del compartir.
          </p>
        </div>

        <div className="rounded-2xl border border-outline-variant bg-white p-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-primary">Disponibilidad real</h3>
            <p className="mt-1 text-xs text-on-surface-variant">
              Si queres ofrecer 20hs en una placa de 30 min, el cierre debe ser al menos 20:30.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">Inicio</span>
              <input
                type="time"
                step="900"
                value={availabilityStartTime ?? availabilityWindow.startTime}
                onChange={(event) => onAvailabilityWindowChange({
                  startTime: event.target.value,
                  endTime: availabilityEndTime ?? availabilityWindow.endTime,
                })}
                className="h-11 w-full rounded-xl border border-outline-variant bg-white px-4 text-on-surface focus:border-primary focus:ring-0"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">Cierre real</span>
              <input
                type="time"
                step="900"
                value={availabilityEndTime ?? availabilityWindow.endTime}
                onChange={(event) => onAvailabilityWindowChange({
                  startTime: availabilityStartTime ?? availabilityWindow.startTime,
                  endTime: event.target.value,
                })}
                className="h-11 w-full rounded-xl border border-outline-variant bg-white px-4 text-on-surface focus:border-primary focus:ring-0"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-primary">Horarios de la placa</h3>
              <p className="mt-1 text-xs text-on-surface-variant">
                Estos horarios se muestran en la historia y deben entrar completos dentro del rango real.
              </p>
            </div>
            <button
              type="button"
              onClick={resetSlotTimes}
              className="text-xs font-medium text-on-surface-variant underline"
            >
              Restaurar
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {normalizedSlotTimes.map((time) => (
              <button
                key={time}
                type="button"
                aria-label={`Quitar ${formatShareTimeLabel(time)}`}
                title={`Quitar ${formatShareTimeLabel(time)}`}
                onClick={() => removeSlotTime(time)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-primary-container bg-primary-container px-3 text-sm font-medium text-primary"
              >
                <span>{formatShareTimeLabel(time)}</span>
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">Horario</span>
              <input
                type="time"
                step="900"
                value={newSlotTime}
                onChange={(event) => {
                  setNewSlotTime(event.target.value);
                  setSlotTimeInputError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addSlotTime();
                  }
                }}
                className="h-11 w-full rounded-xl border border-outline-variant bg-white px-4 text-on-surface focus:border-primary focus:ring-0"
              />
            </label>

            <button
              type="button"
              onClick={addSlotTime}
              className="h-11 self-end rounded-xl border border-outline-variant bg-secondary-container px-4 text-sm font-medium text-on-secondary-container"
            >
              Agregar
            </button>
          </div>

          {slotTimeInputError && (
            <p className="mt-3 text-sm text-error">{slotTimeInputError}</p>
          )}
        </div>

        <div className="rounded-2xl border border-outline-variant bg-white p-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-primary">Fondo de compartir</h3>
            <p className="mt-1 text-xs text-on-surface-variant">
              Podes elegir una foto ya cargada, pegar un link o subir una nueva.
            </p>
          </div>

          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-[1.5px] text-on-surface-variant">Fuente actual</p>
              <p className="text-sm font-medium text-primary">{backgroundSourceLabel}</p>
            </div>
            <div className="h-14 w-14 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-highest">
              <img
                src={backgroundImage}
                alt="Vista previa del fondo"
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          {backgroundChoices.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-[1.5px] text-on-surface-variant">
                Elegir una foto existente
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {backgroundChoices.map((choice) => {
                  const isSelected = shareBackgroundImageUrl?.trim() === choice.src;

                  return (
                    <button
                      key={choice.src}
                      type="button"
                      onClick={() => onShareBackgroundImageChange({
                        imageUrl: choice.src,
                        sourceType: 'library',
                      })}
                      className={`overflow-hidden rounded-2xl border text-left transition-all ${isSelected ? 'border-primary bg-primary-container shadow-sm' : 'border-outline-variant bg-white hover:border-primary-container'}`}
                    >
                      <div className="h-28 w-full overflow-hidden">
                        <img
                          src={choice.src}
                          alt={choice.label}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="space-y-1 px-3 py-3">
                        <p className="text-sm font-medium text-primary">{choice.label}</p>
                        <p className="text-xs text-on-surface-variant">{choice.caption}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-primary">Pegar link</span>
              <input
                type="url"
                value={shareBackgroundImageUrl ?? ''}
                onChange={(event) => onShareBackgroundImageChange({
                  imageUrl: event.target.value,
                  sourceType: 'url',
                })}
                className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-on-surface focus:border-primary focus:ring-0"
                placeholder="https://..."
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-primary">Subir nueva foto</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => void onShareBackgroundUpload(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface file:mr-4 file:rounded-lg file:border-0 file:bg-primary-container file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
              />
            </label>
          </div>

          {uploadingBackgroundImage && (
            <p className="mt-3 text-sm text-on-surface-variant">Subiendo fondo...</p>
          )}

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-primary">Oscuridad del fondo</span>
              <span className="text-sm text-on-surface-variant">{overlayOpacity}%</span>
            </div>
            <input
              type="range"
              min="0"
              max={String(MAX_SHARE_BACKGROUND_OVERLAY_OPACITY)}
              step="5"
              value={overlayOpacity}
              onChange={(event) => onShareBackgroundOverlayOpacityChange(Number(event.target.value))}
              className="w-full accent-[var(--color-primary-dim)]"
            />
          </div>
        </div>

        {shareSettingsValidationError && (
          <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
            {shareSettingsValidationError}
          </div>
        )}
        {shareSettingsSaveNotice && (
          <div role="status" className="rounded-xl border border-primary-container bg-primary-container px-4 py-3 text-sm text-primary">
            {shareSettingsSaveNotice}
          </div>
        )}
        {shareSettingsSaveError && (
          <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
            {shareSettingsSaveError}
          </div>
        )}

        <button
          type="button"
          onClick={saveShareSettings}
          disabled={savingShareSettings || !!shareSettingsValidationError}
          className="h-11 rounded-xl bg-primary-dim px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {savingShareSettings ? 'Guardando...' : 'Guardar Compartir'}
        </button>
      </div>

      <div className="mx-auto w-full max-w-[360px]">
        <div className="flex items-center justify-between gap-3 pb-4">
          <button
            type="button"
            aria-label="Semana anterior"
            title="Semana anterior"
            onClick={() => setWeekStart((current) => subWeeks(current, 1))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-outline-variant bg-white text-primary"
          >
            <span className="material-symbols-outlined text-[22px]">chevron_left</span>
          </button>

          <div className="min-w-0 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[2px] text-on-surface-variant">Semana</p>
            <p className="text-sm font-medium text-primary">{formatWeekRange(weekStart)}</p>
          </div>

          <button
            type="button"
            aria-label="Semana siguiente"
            title="Semana siguiente"
            onClick={() => setWeekStart((current) => addWeeks(current, 1))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-outline-variant bg-white text-primary"
          >
            <span className="material-symbols-outlined text-[22px]">chevron_right</span>
          </button>
        </div>

        <div className="relative aspect-[9/16] overflow-hidden bg-[#111111] text-white shadow-[0_24px_60px_rgba(48,25,25,0.28)]">
          <img
            src={backgroundImage}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: `rgba(0,0,0,${overlayOpacity / 100})` }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, rgba(0,0,0,${gradientTopOpacity}), rgba(0,0,0,${gradientMiddleOpacity}) 42%, rgba(0,0,0,${gradientBottomOpacity}))`,
            }}
          />

          <div
            className="relative z-10 flex h-full flex-col px-7 py-8 text-center"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.78)' }}
          >
            <div className="mb-5">
              <p className="text-[14px] font-medium tracking-wide text-white/90">{formatWeekRange(weekStart)}</p>
              <h3 className="font-serif text-[36px] leading-none text-white">Turnos</h3>
              <p className="font-serif text-[25px] italic leading-none text-white">de la semana</p>
            </div>

            <div className={`flex flex-1 flex-col justify-center ${hasManySlotTimes ? 'gap-3' : 'gap-4'}`}>
              {weekAvailability.map((day) => (
                <div
                  key={day.dateKey}
                  className={`font-serif leading-[1.16] text-white ${hasManySlotTimes ? 'text-[18px]' : 'text-[21px]'}`}
                >
                  <span>{capitalize(format(day.date, 'EEEE', { locale: es }))}</span>{' '}
                  {day.slots.length > 0 ? (
                    day.slots.map((slot, index) => (
                      <span key={slot.time}>
                        {index > 0 && <span className="mx-1 text-white/80">/</span>}
                        <span className="relative inline-flex items-center">
                          {shouldRenderBookedStrike(slot.status) && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute left-[-3px] right-[-3px] top-1/2 h-[2px] -translate-y-1/2 rotate-[-9deg] rounded-full bg-[#ffd6df] shadow-[0_0_8px_rgba(255,214,223,0.55)]"
                            />
                          )}
                          <span className={getSlotClassName(slot.status)}>
                            {formatShareTimeLabel(slot.time)}
                          </span>
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-white/45">--</span>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-5 font-serif text-[22px] text-white">Minimilagros</p>
          </div>
        </div>
      </div>
    </div>
  );
}

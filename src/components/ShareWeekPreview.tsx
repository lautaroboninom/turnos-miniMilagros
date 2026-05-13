import { useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek, subWeeks } from 'date-fns';
import { es } from 'date-fns/locale';
import type {
  Appointment,
  GalleryImage,
  Service,
} from '../types';
import {
  buildShareWeekAvailability,
  isValidTimeValue,
  MAX_SHARE_SLOT_TIMES,
  normalizeShareSlotTimes,
  SHARE_SLOT_DURATION_MINUTES,
  SHARE_SLOT_TIMES,
  type ShareSlotStatus,
} from '../lib/availability';

type ShareWeekPreviewProps = {
  services: Service[];
  appointments: Appointment[];
  galleryImages?: GalleryImage[];
  slotTimes?: string[];
  onSlotTimesChange: (slotTimes: string[]) => void;
  onSaveSlotTimes: (slotTimes: string[]) => void | Promise<void>;
  savingSlotTimes?: boolean;
  slotTimesSaveNotice?: string;
  slotTimesSaveError?: string;
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const formatShareTime = (time: string) => {
  const [hours, minutes] = time.split(':');
  return minutes === '00' ? `${hours}hs` : `${hours}:${minutes}hs`;
};

const formatWeekRange = (weekStart: Date) => {
  const weekEnd = addDays(weekStart, 5);

  const sameMonth = format(weekStart, 'MM-yyyy') === format(weekEnd, 'MM-yyyy');
  if (sameMonth) {
    return `Del ${format(weekStart, 'd')} al ${format(weekEnd, "d 'de' MMMM", { locale: es })}`;
  }

  return `Del ${format(weekStart, "d 'de' MMMM", { locale: es })} al ${format(weekEnd, "d 'de' MMMM", { locale: es })}`;
};

const getBackgroundImage = (
  services: Service[],
  galleryImages: GalleryImage[] | undefined,
) => (
  services.find((service) => service.isActive && service.imageUrl?.trim())?.imageUrl?.trim() ||
  galleryImages?.find((image) => image.src.trim())?.src.trim() ||
  '/mini-milagros-watermark.webp'
);

const getSlotClassName = (status: ShareSlotStatus) => (
  status === 'unavailable'
    ? 'relative inline-block text-white/45 line-through decoration-[#ffd6df] decoration-[2px] decoration-solid'
    : 'relative inline-block text-white'
);

export default function ShareWeekPreview({
  services,
  appointments,
  galleryImages,
  slotTimes,
  onSlotTimesChange,
  onSaveSlotTimes,
  savingSlotTimes = false,
  slotTimesSaveNotice = '',
  slotTimesSaveError = '',
}: ShareWeekPreviewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [newSlotTime, setNewSlotTime] = useState('');
  const [slotTimeInputError, setSlotTimeInputError] = useState('');

  const normalizedSlotTimes = useMemo(() => normalizeShareSlotTimes(slotTimes), [slotTimes]);
  const hasManySlotTimes = normalizedSlotTimes.length > 6;

  const weekAvailability = useMemo(
    () => buildShareWeekAvailability(
      weekStart,
      SHARE_SLOT_DURATION_MINUTES,
      appointments,
      normalizedSlotTimes,
    ),
    [appointments, normalizedSlotTimes, weekStart],
  );

  const backgroundImage = getBackgroundImage(services, galleryImages);

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

  const saveSlotTimes = () => {
    void onSaveSlotTimes(normalizedSlotTimes);
  };

  return (
    <div className="space-y-6">
      <div className="bg-background border border-primary-container p-5 rounded-[16px] shadow-sm space-y-5">
        <h2 className="font-serif text-[18px] text-primary">Compartir turnos</h2>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Semana anterior"
            title="Semana anterior"
            onClick={() => setWeekStart((current) => subWeeks(current, 1))}
            className="h-11 w-11 shrink-0 rounded-xl border border-outline-variant bg-white text-primary flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[22px]">chevron_left</span>
          </button>

          <div className="min-w-0 text-center">
            <p className="text-[11px] uppercase tracking-[2px] font-bold text-on-surface-variant">Semana</p>
            <p className="text-sm font-medium text-primary">{formatWeekRange(weekStart)}</p>
          </div>

          <button
            type="button"
            aria-label="Semana siguiente"
            title="Semana siguiente"
            onClick={() => setWeekStart((current) => addWeeks(current, 1))}
            className="h-11 w-11 shrink-0 rounded-xl border border-outline-variant bg-white text-primary flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[22px]">chevron_right</span>
          </button>
        </div>

        <div className="rounded-2xl border border-outline-variant bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-primary">Horarios de la placa</span>
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
                aria-label={`Quitar ${formatShareTime(time)}`}
                title={`Quitar ${formatShareTime(time)}`}
                onClick={() => removeSlotTime(time)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-primary-container bg-primary-container px-3 text-sm font-medium text-primary"
              >
                <span>{formatShareTime(time)}</span>
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="block">
              <span className="block text-xs font-medium text-on-surface-variant mb-1">Horario</span>
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
              className="h-11 self-end rounded-xl bg-secondary-container px-4 text-sm font-medium text-on-secondary-container border border-outline-variant"
            >
              Agregar
            </button>
            <button
              type="button"
              onClick={saveSlotTimes}
              disabled={savingSlotTimes}
              className="h-11 self-end rounded-xl bg-primary-dim px-4 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {savingSlotTimes ? 'Guardando...' : 'Guardar'}
            </button>
          </div>

          {slotTimeInputError && (
            <p className="mt-3 text-sm text-error">{slotTimeInputError}</p>
          )}
          {slotTimesSaveNotice && (
            <div role="status" className="mt-3 rounded-xl border border-primary-container bg-primary-container px-4 py-3 text-sm text-primary">
              {slotTimesSaveNotice}
            </div>
          )}
          {slotTimesSaveError && (
            <div role="alert" className="mt-3 rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
              {slotTimesSaveError}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[360px]">
        <div className="relative aspect-[9/16] overflow-hidden bg-[#111111] text-white shadow-[0_24px_60px_rgba(48,25,25,0.28)]">
          <img
            src={backgroundImage}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-55"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.72),rgba(0,0,0,0.34)_42%,rgba(0,0,0,0.72))]" />

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
                        <span className={getSlotClassName(slot.status)}>
                          {formatShareTime(slot.time)}
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

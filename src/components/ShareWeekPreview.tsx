import { useEffect, useMemo, useState } from 'react';
import { addDays, addWeeks, format, startOfWeek, subWeeks } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  DEFAULT_EMPLOYEE_ID,
  type Appointment,
  type GalleryImage,
  type Service,
} from '../types';
import { buildShareWeekAvailability, type ShareSlotStatus } from '../lib/availability';

type ShareWeekPreviewProps = {
  services: Service[];
  appointments: Appointment[];
  galleryImages?: GalleryImage[];
};

const getServiceEmployeeId = (service: Service) => service.employeeId?.trim() || DEFAULT_EMPLOYEE_ID;

const getAppointmentEmployeeId = (appointment: Appointment) => appointment.employeeId?.trim() || DEFAULT_EMPLOYEE_ID;

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const formatShareTime = (time: string) => `${time.slice(0, 2)}hs`;

const formatWeekRange = (weekStart: Date) => {
  const weekEnd = addDays(weekStart, 5);

  const sameMonth = format(weekStart, 'MM-yyyy') === format(weekEnd, 'MM-yyyy');
  if (sameMonth) {
    return `Del ${format(weekStart, 'd')} al ${format(weekEnd, "d 'de' MMMM", { locale: es })}`;
  }

  return `Del ${format(weekStart, "d 'de' MMMM", { locale: es })} al ${format(weekEnd, "d 'de' MMMM", { locale: es })}`;
};

const getBackgroundImage = (
  selectedService: Service | undefined,
  services: Service[],
  galleryImages: GalleryImage[] | undefined,
) => (
  selectedService?.imageUrl?.trim() ||
  services.find((service) => service.imageUrl?.trim())?.imageUrl?.trim() ||
  galleryImages?.find((image) => image.src.trim())?.src.trim() ||
  '/mini-milagros-watermark.webp'
);

const getSlotClassName = (status: ShareSlotStatus) => (
  status === 'unavailable'
    ? 'relative inline-block text-white/45 line-through decoration-[#ffd6df] decoration-[2px] decoration-solid'
    : 'relative inline-block text-white'
);

export default function ShareWeekPreview({ services, appointments, galleryImages }: ShareWeekPreviewProps) {
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const selectableServices = useMemo(
    () => services
      .filter((service) => service.isActive)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [services],
  );

  useEffect(() => {
    if (selectableServices.length === 0) {
      if (selectedServiceId) setSelectedServiceId('');
      return;
    }

    if (!selectableServices.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(selectableServices[0].id);
    }
  }, [selectableServices, selectedServiceId]);

  const selectedService = selectableServices.find((service) => service.id === selectedServiceId);

  const relevantAppointments = useMemo(() => {
    if (!selectedService) return [];
    const serviceEmployeeId = getServiceEmployeeId(selectedService);
    return appointments.filter((appointment) => getAppointmentEmployeeId(appointment) === serviceEmployeeId);
  }, [appointments, selectedService]);

  const weekAvailability = useMemo(
    () => selectedService
      ? buildShareWeekAvailability(weekStart, selectedService.durationMinutes, relevantAppointments)
      : [],
    [relevantAppointments, selectedService, weekStart],
  );

  const backgroundImage = getBackgroundImage(selectedService, selectableServices, galleryImages);

  if (selectableServices.length === 0) {
    return (
      <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm">
        <h2 className="font-serif text-[18px] mb-2 text-primary">Compartir turnos</h2>
        <p className="text-sm text-on-surface-variant">No hay servicios activos para armar la placa.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-background border border-primary-container p-5 rounded-[16px] shadow-sm space-y-4">
        <h2 className="font-serif text-[18px] text-primary">Compartir turnos</h2>

        <label className="block">
          <span className="block text-sm font-medium text-primary mb-2">Servicio</span>
          <select
            value={selectedServiceId}
            onChange={(event) => setSelectedServiceId(event.target.value)}
            className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface"
          >
            {selectableServices.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>

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

            <div className="flex flex-1 flex-col justify-center gap-4">
              {weekAvailability.map((day) => (
                <div key={day.dateKey} className="font-serif text-[21px] leading-[1.16] text-white">
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

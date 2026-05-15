import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, addMinutes, format, getDay, parse } from 'date-fns';
import { es } from 'date-fns/locale';
import { doc, getDoc, getDocs, query, where, collection } from 'firebase/firestore';
import Layout from '../components/Layout';
import { db, handleFirestoreError, OperationType, savePublicPendingAppointment } from '../firebase';
import { getAvailableSlotsForDate, type AvailabilityAppointment } from '../lib/availability';
import { DEFAULT_EMPLOYEE_ID, DEFAULT_EMPLOYEE_NAME, type Appointment, type Service, type StudioSettings } from '../types';

const getServiceEmployeeId = (service: Service) => service.employeeId?.trim() || DEFAULT_EMPLOYEE_ID;
const getServiceEmployeeName = (service: Service) => service.employeeName?.trim() || DEFAULT_EMPLOYEE_NAME;
const WHATSAPP_PHONE = '5491139244063';
const RESERVATION_SAVE_TIMEOUT_MS = 8000;

const buildReservationMessage = (
  firstName: string,
  lastName: string,
  service: Service,
  prettyDate: string,
  selectedTime: string,
  depositAmount: number,
) => (
  [
    'Hola MiniMilagros! Te llego una nueva reserva.',
    '',
    `Cliente: ${firstName.trim()} ${lastName.trim()}`,
    `Servicio: ${service.name}`,
    `Fecha: ${prettyDate}`,
    `Horario: ${selectedTime} hs`,
    `Duracion: ${service.durationMinutes} min`,
    `Total: $${service.price}`,
    `Sena sugerida: $${depositAmount}`,
  ].join('\n')
);

const buildWhatsAppRedirectUrl = (phone: string, text: string) => {
  const search = new URLSearchParams({
    phone,
    text,
  });

  return `/redirigir-whatsapp?${search.toString()}`;
};

const openPendingWhatsAppWindow = () => {
  if (typeof window === 'undefined') return null;

  const nextWindow = window.open('', '_blank');
  if (!nextWindow) return null;

  nextWindow.opener = null;
  nextWindow.document.title = 'Abriendo WhatsApp';
  nextWindow.document.body.style.margin = '0';
  nextWindow.document.body.style.fontFamily = 'Arial, sans-serif';
  nextWindow.document.body.style.background = '#fff7f7';
  nextWindow.document.body.style.color = '#7d5050';
  nextWindow.document.body.style.display = 'flex';
  nextWindow.document.body.style.alignItems = 'center';
  nextWindow.document.body.style.justifyContent = 'center';
  nextWindow.document.body.innerHTML = '<div style="padding:24px;text-align:center;max-width:320px;"><h1 style="font-size:20px;margin:0 0 12px;">Estamos preparando tu WhatsApp</h1><p style="margin:0;font-size:14px;line-height:1.5;">Guardando el turno y armando el mensaje para MiniMilagros.</p></div>';

  return nextWindow;
};

export default function Booking() {
  const { serviceId } = useParams();
  const navigate = useNavigate();

  const [service, setService] = useState<Service | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        if (!serviceId) return;

        const serviceSnap = await getDoc(doc(db, 'services', serviceId));
        if (serviceSnap.exists()) {
          setService({ id: serviceSnap.id, ...serviceSnap.data() } as Service);
        }

        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        if (settingsSnap.exists()) {
          setSettings(settingsSnap.data() as StudioSettings);
        } else {
          setSettings({ depositAmount: 5000, updatedAt: new Date().toISOString() });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'services/settings');
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [serviceId]);

  useEffect(() => {
    if (!service) return;

    async function generateSlots() {
      if (getDay(selectedDate) === 0) {
        setAvailableSlots([]);
        return;
      }

      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const serviceEmployeeId = getServiceEmployeeId(service);

      try {
        const appointmentsQuery = query(
          collection(db, 'appointments'),
          where('date', '==', dateStr),
          where('status', 'in', ['pending', 'confirmed']),
        );
        const snap = await getDocs(appointmentsQuery);

        const relevantAppointments = snap.docs
          .map((entry) => entry.data() as AvailabilityAppointment & { employeeId?: string })
          .filter((appointment) => {
            const appointmentEmployeeId = typeof appointment.employeeId === 'string' && appointment.employeeId.trim()
              ? appointment.employeeId.trim()
              : DEFAULT_EMPLOYEE_ID;

            return appointmentEmployeeId === serviceEmployeeId;
          });

        setAvailableSlots(
          getAvailableSlotsForDate(selectedDate, service.durationMinutes, relevantAppointments),
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'appointments');
      }
    }

    void generateSlots();
  }, [selectedDate, service]);

  const handleConfirm = async () => {
    if (!service || !selectedTime || !firstName || !lastName || !settings) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const prettyDate = format(selectedDate, "eeee d 'de' MMMM", { locale: es });
    const message = buildReservationMessage(
      firstName,
      lastName,
      service,
      prettyDate,
      selectedTime,
      settings.depositAmount,
    );
    const redirectUrl = buildWhatsAppRedirectUrl(WHATSAPP_PHONE, message);
    const pendingWhatsAppWindow = openPendingWhatsAppWindow();

    setBooking(true);

    try {
      const timeParsed = parse(selectedTime, 'HH:mm', selectedDate);
      const endTimeParsed = addMinutes(timeParsed, service.durationMinutes);
      const endTimeStr = format(endTimeParsed, 'HH:mm');
      const employeeId = getServiceEmployeeId(service);
      const employeeName = getServiceEmployeeName(service);

      const newAppointment: Omit<Appointment, 'id'> & { status: 'pending' } = {
        serviceId: service.id,
        serviceName: service.name,
        employeeId,
        employeeName,
        durationMinutes: service.durationMinutes,
        price: service.price,
        date: dateStr,
        startTime: selectedTime,
        endTime: endTimeStr,
        clientFirstName: firstName.trim(),
        clientLastName: lastName.trim(),
        status: 'pending' as const,
        depositAmount: settings.depositAmount,
        createdAt: new Date().toISOString(),
      };

      await savePublicPendingAppointment(newAppointment, RESERVATION_SAVE_TIMEOUT_MS);

      if (!pendingWhatsAppWindow || pendingWhatsAppWindow.closed) {
        window.location.assign(redirectUrl);
        return;
      }

      pendingWhatsAppWindow.location.replace(redirectUrl);
      navigate('/', { replace: true });
    } catch (error) {
      pendingWhatsAppWindow?.close();
      alert('No se pudo guardar el turno. No abrimos WhatsApp para evitar reservas sin registrar. Revisa la conexion e intenta nuevamente.');
      try {
        handleFirestoreError(error, OperationType.CREATE, 'appointments');
      } catch {
        // Keep the booking screen usable after logging the error context.
      }
    } finally {
      setBooking(false);
    }
  };

  if (loading) return <Layout><p>Cargando detalles...</p></Layout>;
  if (!service) return <Layout><p>Servicio no encontrado.</p></Layout>;

  return (
    <Layout>
      <div className="mb-6">
        <div className="relative flex justify-between bg-outline-variant h-[2px]">
          <div className={`absolute left-0 h-[2px] bg-primary-dim transition-all ${step === 1 ? 'w-[33%]' : 'w-[66%]'}`} />
        </div>
        <div className="mt-2 flex justify-between px-1">
          <span className="text-[10px] font-bold uppercase text-primary-dim">Servicio</span>
          <span className={`text-[10px] font-bold uppercase ${step === 1 ? 'text-on-surface-variant' : 'text-primary-dim'}`}>Fecha</span>
          <span className="text-[10px] font-bold uppercase text-on-surface-variant">Confirmar</span>
        </div>
      </div>

      <button
        onClick={() => (step > 1 ? setStep(step - 1) : navigate('/'))}
        className="mb-6 flex items-center text-[11px] font-bold uppercase tracking-widest text-on-surface-variant"
      >
        <span className="material-symbols-outlined mr-1 text-sm">arrow_back</span>
        Volver
      </button>

      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="mb-2 text-3xl font-serif text-primary">Selecciona fecha y hora</h1>
          <p className="mb-8 font-light text-on-surface-variant">
            Estas agendando <strong className="font-serif">"{service.name}"</strong> ({service.durationMinutes} min)
          </p>

          <div className="mb-8 rounded-2xl bg-surface-container-lowest p-6 shadow-[0_20px_40px_rgba(136,79,80,0.05)]">
            <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
              {[...Array(14)].map((_, index) => {
                const date = addDays(new Date(), index);
                const isSelected = format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                const isSunday = getDay(date) === 0;

                return (
                  <button
                    key={index}
                    onClick={() => !isSunday && setSelectedDate(date)}
                    disabled={isSunday}
                    className={`flex min-w-[4rem] flex-col items-center rounded-xl p-3 transition-all ${isSelected ? 'bg-primary-container text-on-primary-container shadow-inner' : isSunday ? 'cursor-not-allowed opacity-30' : 'bg-surface-container-low hover:bg-surface-container'}`}
                  >
                    <span className="text-xs uppercase tracking-widest">{format(date, 'eee', { locale: es })}</span>
                    <span className="mt-1 text-xl font-serif">{format(date, 'd')}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 border-t border-primary-container pt-6">
              <h3 className="mb-4 text-[18px] font-serif text-primary">Horarios disponibles</h3>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {availableSlots.length > 0 ? availableSlots.map((time) => (
                  <button
                    key={time}
                    onClick={() => setSelectedTime(time)}
                    className={`rounded-xl border p-3 text-sm font-medium transition-all ${selectedTime === time ? 'border-primary-dim bg-primary-dim text-white shadow-[0_4px_12px_rgba(232,160,160,0.3)]' : 'border-outline-variant bg-surface-bright hover:border-primary-dim'}`}
                  >
                    {time}
                  </button>
                )) : (
                  <p className="col-span-full py-4 text-sm text-on-surface-variant">No hay turnos disponibles este dia.</p>
                )}
              </div>
            </div>
          </div>

          <button
            disabled={!selectedTime}
            onClick={() => setStep(2)}
            className="w-full rounded-xl bg-primary-dim px-8 py-4 text-[15px] font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Agendar turno
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="mb-2 text-3xl font-serif text-primary">Resumen de turno</h1>
          <p className="mb-8 font-light text-on-surface-variant">Por favor, revisa los detalles y completa tus datos.</p>

          <div className="relative mb-8 space-y-4 overflow-hidden rounded-[16px] border border-primary-container bg-background p-6 shadow-sm">
            <div className="relative z-10 flex items-center justify-between border-b border-primary-container pb-4">
              <div>
                <p className="mb-1 text-[12px] text-on-surface-variant">Servicio</p>
                <p className="text-[15px] font-medium text-primary">{service.name}</p>
                <p className="mt-1 text-[12px] text-on-surface-variant">Atiende: {getServiceEmployeeName(service)}</p>
              </div>
              <p className="text-[14px] font-bold text-primary">${service.price}</p>
            </div>

            <div className="relative z-10 flex items-center justify-between pb-4">
              <div>
                <p className="mb-1 text-[12px] text-on-surface-variant">Fecha y hora</p>
                <p className="text-[14px] text-on-surface">{format(selectedDate, "eeee d 'de' MMMM", { locale: es })}</p>
                <p className="mt-1 text-[12px] text-on-surface-variant">{selectedTime} hs - {service.durationMinutes} min</p>
              </div>
            </div>

            <div className="relative z-10 mt-4 rounded-xl bg-primary-container p-4 text-sm text-on-primary-container">
              Sena sugerida: <strong>${settings.depositAmount}</strong> al Alias: bichito.21
            </div>
          </div>

          <div className="mb-8 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Nombre</label>
              <input
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-on-surface transition-colors focus:border-primary focus:ring-0"
                placeholder="Tu nombre"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Apellido</label>
              <input
                type="text"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-on-surface transition-colors focus:border-primary focus:ring-0"
                placeholder="Tu apellido"
              />
            </div>
          </div>

          <button
            disabled={!firstName.trim() || !lastName.trim() || booking}
            onClick={handleConfirm}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-dim px-8 py-4 text-[15px] font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {booking ? 'Confirmando...' : 'Confirmar y enviar WhatsApp'}
            <span className="material-symbols-outlined text-[20px]">send</span>
          </button>
        </div>
      )}
    </Layout>
  );
}

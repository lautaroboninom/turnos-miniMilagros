import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { Service, StudioSettings } from '../types';
import { format, addMinutes, parse, isBefore, startOfDay, endOfDay, addDays, getDay } from 'date-fns';
import { es } from 'date-fns/locale';

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
        
        // Fetch Service
        const serviceSnap = await getDoc(doc(db, 'services', serviceId));
        if (serviceSnap.exists()) {
          setService({ id: serviceSnap.id, ...serviceSnap.data() } as Service);
        }

        // Fetch Settings (for deposit)
        const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
        if (settingsSnap.exists()) {
          setSettings(settingsSnap.data() as StudioSettings);
        } else {
          setSettings({ depositAmount: 5000, updatedAt: new Date().toISOString() }); // Fallback
        }
      } catch (error) {
         handleFirestoreError(error, OperationType.GET, 'services/settings');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [serviceId]);

  useEffect(() => {
    if (!service || !selectedDate) return;
    
    // Generate slots based on logic (08:00 to 19:00 Mon-Sat)
    async function generateSlots() {
      const dayOfWeek = getDay(selectedDate);
      if (dayOfWeek === 0) { // Sunday
        setAvailableSlots([]);
        return;
      }

      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      
      // Fetch appointments for this day
      try {
        const q = query(collection(db, 'appointments'), where('date', '==', dateStr), where('status', 'in', ['pending', 'confirmed']));
        const snap = await getDocs(q);
        
        const bookedIntervals = snap.docs.map(d => {
          const data = d.data();
          const start = parse(data.startTime, 'HH:mm', selectedDate);
          const end = parse(data.endTime, 'HH:mm', selectedDate);
          return { start, end };
        });

        // Generate options every 30 mins
        let current = parse('08:00', 'HH:mm', selectedDate);
        const endOfDayLimit = parse('19:00', 'HH:mm', selectedDate);
        
        const slots: string[] = [];
        
        while (isBefore(current, endOfDayLimit)) {
          const potentialEnd = addMinutes(current, service.durationMinutes);
          
          if (isBefore(potentialEnd, addMinutes(endOfDayLimit, 1))) {
            // Check overlaps
            let overlap = false;
            for (const { start, end } of bookedIntervals) {
              if (
                (isBefore(current, end) && isBefore(start, potentialEnd))
              ) {
                overlap = true;
                break;
              }
            }
            
            // If today, check if it's in the past
            if (dateStr === format(new Date(), 'yyyy-MM-dd') && isBefore(current, new Date())) {
              overlap = true;
            }

            if (!overlap) {
              slots.push(format(current, 'HH:mm'));
            }
          }
          current = addMinutes(current, 30); // 30 min increments
        }
        
        setAvailableSlots(slots);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'appointments');
      }
    }
    
    generateSlots();
  }, [selectedDate, service]);


  const handleConfirm = async () => {
    if (!service || !selectedTime || !firstName || !lastName || !settings) return;
    setBooking(true);
    
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const timeParsed = parse(selectedTime, 'HH:mm', selectedDate);
      const endTimeParsed = addMinutes(timeParsed, service.durationMinutes);
      const endTimeStr = format(endTimeParsed, 'HH:mm');
      
      const newAppt = {
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        date: dateStr,
        startTime: selectedTime,
        endTime: endTimeStr,
        clientFirstName: firstName,
        clientLastName: lastName,
        status: 'pending',
        depositAmount: settings.depositAmount,
        createdAt: new Date().toISOString()
      };
      
      await addDoc(collection(db, 'appointments'), newAppt);
      
      // WhatsApp redirect
      const prettyDate = format(selectedDate, "eeee d 'de' MMMM", { locale: es });
      const encodedMsg = encodeURIComponent(`¡Hola MiniMilagros! Soy ${firstName} ${lastName}, reservé un turno de ${service.name} para el ${prettyDate} a las ${selectedTime} hs. El total es $${service.price}. Adjunto el comprobante de seña por $${settings.depositAmount}.`);
      
      window.location.href = `https://wa.me/5491139244063?text=${encodedMsg}`;
      
    } catch (e) {
       handleFirestoreError(e, OperationType.CREATE, 'appointments');
    } finally {
      setBooking(false);
    }
  };

  if (loading) return <Layout><p>Cargando details...</p></Layout>;
  if (!service) return <Layout><p>Servicio no encontrado.</p></Layout>;

  return (
    <Layout>
      <div className="mb-6">
        <div className="h-[2px] bg-outline-variant flex justify-between relative">
          <div className={`h-[2px] bg-primary-dim absolute left-0 transition-all ${step === 1 ? 'w-[33%]' : 'w-[66%]'}`}></div>
        </div>
        <div className="flex justify-between mt-2 px-1">
          <span className="text-[10px] uppercase font-bold text-primary-dim">Servicio</span>
          <span className={`text-[10px] uppercase font-bold ${step === 1 ? 'text-on-surface-variant' : 'text-primary-dim'}`}>Fecha</span>
          <span className="text-[10px] uppercase font-bold text-on-surface-variant">Confirmar</span>
        </div>
      </div>

      <button onClick={() => step > 1 ? setStep(step - 1) : navigate('/')} className="text-on-surface-variant mb-6 flex items-center text-[11px] uppercase tracking-widest font-bold">
        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span>
        Volver
      </button>

      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
           <h1 className="text-3xl font-serif text-primary mb-2">Seleccioná fecha y hora</h1>
           <p className="text-on-surface-variant font-light mb-8">Estás agendando <strong className="font-serif">"{service.name}"</strong> ({service.durationMinutes} min)</p>
           
           <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-[0_20px_40px_rgba(136,79,80,0.05)] mb-8">
             {/* Simple Calendar Strip */}
             <div className="flex overflow-x-auto gap-3 pb-4 no-scrollbar">
                {[...Array(14)].map((_, i) => {
                  const d = addDays(new Date(), i);
                  const isSelected = format(d, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
                  const isSun = getDay(d) === 0;
                  return (
                    <button 
                      key={i} 
                      onClick={() => !isSun && setSelectedDate(d)}
                      disabled={isSun}
                      className={`flex flex-col items-center min-w-[4rem] p-3 rounded-xl transition-all ${isSelected ? 'bg-primary-container text-on-primary-container shadow-inner' : isSun ? 'opacity-30 cursor-not-allowed' : 'bg-surface-container-low hover:bg-surface-container'} `}
                    >
                      <span className="text-xs uppercase tracking-widest">{format(d, 'eee', {locale: es})}</span>
                      <span className="text-xl font-serif mt-1">{format(d, 'd')}</span>
                    </button>
                  )
                })}
             </div>

             <div className="mt-6 border-t border-primary-container pt-6">
                <h3 className="font-serif text-[18px] mb-4 text-primary">Horarios Disponibles</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {availableSlots.length > 0 ? availableSlots.map(time => (
                    <button
                      key={time}
                      onClick={() => setSelectedTime(time)}
                      className={`p-3 rounded-xl text-sm font-medium transition-all border ${selectedTime === time ? 'bg-primary-dim text-white border-primary-dim shadow-[0_4px_12px_rgba(232,160,160,0.3)]' : 'bg-surface-bright border-outline-variant hover:border-primary-dim'}`}
                    >
                      {time}
                    </button>
                  )) : (
                    <p className="col-span-full text-on-surface-variant text-sm py-4">No hay turnos disponibles este día.</p>
                  )}
                </div>
             </div>
           </div>

           <button 
             disabled={!selectedTime}
             onClick={() => setStep(2)}
             className="w-full bg-primary-dim text-white py-4 px-8 rounded-xl text-[15px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
           >
             Agendar Turno
           </button>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
           <h1 className="text-3xl font-serif text-primary mb-2">Resumen de Turno</h1>
           <p className="text-on-surface-variant font-light mb-8">Por favor, revisá los detalles y completá tus datos.</p>

           <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm mb-8 space-y-4 relative overflow-hidden">
             
             <div className="flex justify-between items-center border-b border-primary-container pb-4 relative z-10">
               <div>
                  <p className="text-[12px] text-on-surface-variant mb-1">Servicio</p>
                  <p className="font-sans font-medium text-[15px] text-primary">{service.name}</p>
               </div>
               <p className="font-bold text-[14px] text-primary">${service.price}</p>
             </div>

             <div className="flex justify-between items-center pb-4 relative z-10">
               <div>
                  <p className="text-[12px] text-on-surface-variant mb-1">Fecha y Hora</p>
                  <p className="text-on-surface text-[14px]">{format(selectedDate, "eeee d 'de' MMMM", { locale: es })}</p>
                  <p className="text-on-surface-variant text-[12px] mt-1">{selectedTime} hs • {service.durationMinutes} min</p>
               </div>
             </div>

             <div className="bg-primary-container text-on-primary-container p-4 rounded-xl text-sm mt-4 relative z-10">
                Seña sugerida: <strong>${settings?.depositAmount}</strong> al Alias: bichito.21
             </div>
           </div>

           <div className="mb-8 space-y-4">
              <div>
                <label className="block tracking-wide text-xs font-semibold text-on-surface-variant uppercase mb-1">Nombre</label>
                <input 
                  type="text" 
                  value={firstName} 
                  onChange={e => setFirstName(e.target.value)}
                  className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface transition-colors"
                  placeholder="Tu nombre"
                />
              </div>
              <div>
                <label className="block tracking-wide text-xs font-semibold text-on-surface-variant uppercase mb-1">Apellido</label>
                <input 
                  type="text" 
                  value={lastName} 
                  onChange={e => setLastName(e.target.value)}
                  className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface transition-colors"
                  placeholder="Tu apellido"
                />
              </div>
           </div>

           <button 
             disabled={!firstName || !lastName || booking}
             onClick={handleConfirm}
             className="w-full bg-primary-dim text-white py-4 px-8 rounded-xl text-[15px] font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
           >
             {booking ? 'Confirmando...' : 'Confirmar y enviar WhatsApp'}
             <span className="material-symbols-outlined text-[20px]">send</span>
           </button>
        </div>
      )}
    </Layout>
  );
}

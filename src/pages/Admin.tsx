import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db, auth, loginWithEmail, registerWithEmail, logout, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { Service, Appointment, StudioSettings } from '../types';
import { format } from 'date-fns';

export default function Admin() {
  const [user, setUser] = useState(auth.currentUser);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [settings, setSettings] = useState<StudioSettings>({ depositAmount: 0, updatedAt: new Date().toISOString() });
  
  const [tab, setTab] = useState<'turnos' | 'servicios' | 'config'>('turnos');
  
  const [email, setEmail] = useState('milagros@minimilagros.com');
  const [password, setPassword] = useState('teamo210226');

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(u => setUser(u));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const unsubServices = onSnapshot(collection(db, 'services'), snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Service)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'services'));

    const unsubAppts = onSnapshot(query(collection(db, 'appointments')), snap => {
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'appointments'));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), snap => {
      if (snap.exists()) setSettings(snap.data() as StudioSettings);
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/global'));

    return () => {
      unsubServices();
      unsubAppts();
      unsubSettings();
    };
  }, [user]);

  // Modals / forms state
  const [editingService, setEditingService] = useState<Partial<Service> | null>(null);
  
  const saveService = async () => {
    if (!editingService || !editingService.name || !editingService.durationMinutes || !editingService.price) return;
    try {
      if (editingService.id) {
        await updateDoc(doc(db, 'services', editingService.id), { ...editingService });
      } else {
        await addDoc(collection(db, 'services'), { 
          ...editingService, 
          isActive: editingService.isActive ?? true,
          createdAt: new Date().toISOString()
        });
      }
      setEditingService(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'services');
    }
  };

  const deleteService = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'services', id));
    } catch (e) {
       handleFirestoreError(e, OperationType.DELETE, `services/${id}`);
    }
  };

  const saveSettings = async () => {
    try {
      await setDoc(doc(db, 'settings', 'global'), { ...settings, updatedAt: new Date().toISOString() });
      alert("Configuración guardada");
    } catch (e) {
       handleFirestoreError(e, OperationType.WRITE, 'settings/global');
    }
  }

  const actAppt = async (id: string, status: 'confirmed' | 'cancelled') => {
    try {
      await updateDoc(doc(db, 'appointments', id), { status });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `appointments/${id}`);
    }
  }

  const populateBaseData = async () => {
    const baseServices = [
      { name: "Esmaltado", durationMinutes: 35, price: 5000 },
      { name: "Kapping", durationMinutes: 60, price: 7000 },
      { name: "Esculpidas básicas", durationMinutes: 90, price: 10000 },
      { name: "Full set", durationMinutes: 120, price: 15000 },
      { name: "Depilación definitiva", durationMinutes: 30, price: 4000 },
      { name: "Full cejas", durationMinutes: 60, price: 6000 },
      { name: "Lifting de pestañas", durationMinutes: 60, price: 8000 },
      { name: "Belleza de pies", durationMinutes: 60, price: 7500 },
      { name: "Tratamientos capilares", durationMinutes: 90, price: 12000 },
      { name: "Hidra lips", durationMinutes: 45, price: 9000 },
    ];
    for (const bs of baseServices) {
      await addDoc(collection(db, 'services'), { 
        ...bs, 
        isActive: true, 
        createdAt: new Date().toISOString() 
      });
    }
    alert("Servicios base cargados");
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    try {
      await loginWithEmail(email, password);
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        if (email === 'milagros@minimilagros.com') {
          try {
            await registerWithEmail(email, password);
            return;
          } catch (regErr: any) {
            console.error(regErr);
            alert("Para ingresar, debes habilitar el proveedor 'Correo electrónico/Contraseña' en la pestaña Authentication de tu consola Firebase. (Ver panel de Vercel/Firebase)");
          }
        } else {
          alert('Credenciales incorrectas');
        }
      } else {
        alert("Asegurate de tener habilitado 'Correo electrónico/Contraseña' en Firebase Authentication.");
      }
    }
  }

  if (!user) {
    return (
      <Layout>
        <div className="text-center py-10 bg-background border border-primary-container rounded-[20px] shadow-sm max-w-sm mx-auto">
           <h1 className="text-[24px] font-serif text-primary mb-6">Acceso a Gestor</h1>
           <form onSubmit={handleLogin} className="flex flex-col gap-4 px-6 mb-4">
             <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Tu Email" required />
             <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Contraseña" required />
             <button type="submit" className="bg-primary-dim text-white py-3 rounded-xl font-medium shadow-sm hover:opacity-90 transition-all mt-2">
               Ingresar a la cuenta
             </button>
           </form>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex justify-between items-center mb-8 border-b border-surface-container pb-4">
         <h1 className="text-2xl font-serif text-primary">Panel Dinámico</h1>
         <button onClick={logout} className="text-sm text-on-surface-variant font-medium underline">Salir</button>
      </div>

      <div className="flex gap-4 mb-8 overflow-x-auto pb-2 no-scrollbar">
        <button onClick={() => setTab('turnos')} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === 'turnos' ? 'bg-primary-container text-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant'}`}>
          Turnos
        </button>
        <button onClick={() => setTab('servicios')} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === 'servicios' ? 'bg-primary-container text-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant'}`}>
          Servicios
        </button>
        <button onClick={() => setTab('config')} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === 'config' ? 'bg-primary-container text-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant'}`}>
          Configuración
        </button>
      </div>

      {tab === 'config' && (
        <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm">
           <h2 className="font-serif text-[18px] mb-4 text-primary">Monto de Seña (Fijo)</h2>
           <input 
             type="number" 
             value={settings.depositAmount}
             onChange={e => setSettings({...settings, depositAmount: Number(e.target.value)})}
             className="w-full mb-4 bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3"
           />
           <button onClick={saveSettings} className="bg-primary-dim text-white py-3 px-6 rounded-xl font-medium w-full sm:w-auto">Guardar Configuración</button>
        </div>
      )}

      {tab === 'servicios' && (
        <div>
          <div className="flex gap-4 mb-6">
            <button onClick={() => setEditingService({ isActive: true })} className="bg-primary text-on-primary py-2 px-6 rounded-lg font-medium">
              + Nuevo Servicio
            </button>
            {services.length === 0 && (
              <button onClick={populateBaseData} className="bg-secondary-container text-on-secondary-container py-2 px-6 rounded-lg font-medium shadow-sm">
                Cargar Catálogo Base
              </button>
            )}
          </div>

          {editingService && (
             <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm mb-8">
                <h3 className="font-serif text-[18px] mb-4 text-primary">{editingService.id ? 'Editar' : 'Crear'} Servicio</h3>
                <div className="space-y-4 mb-4">
                  <input type="text" placeholder="Nombre (ej. Esmaltado)" value={editingService.name || ''} onChange={e => setEditingService({...editingService, name: e.target.value})} className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3" />
                  <div className="flex gap-4">
                     <input type="number" placeholder="Minutos (ej. 35)" value={editingService.durationMinutes || ''} onChange={e => setEditingService({...editingService, durationMinutes: Number(e.target.value)})} className="w-1/2 bg-white border border-outline-variant rounded-xl px-4 py-3" />
                     <input type="number" placeholder="Precio ($)" value={editingService.price || ''} onChange={e => setEditingService({...editingService, price: Number(e.target.value)})} className="w-1/2 bg-white border border-outline-variant rounded-xl px-4 py-3" />
                  </div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={editingService.isActive} onChange={e => setEditingService({...editingService, isActive: e.target.checked})} className="rounded text-primary focus:ring-primary" />
                    <span className="text-sm">Activo (visible)</span>
                  </label>
                </div>
                <div className="flex gap-3">
                  <button onClick={saveService} className="bg-primary-dim text-white font-medium py-2 px-6 rounded-xl">Guardar</button>
                  <button onClick={() => setEditingService(null)} className="bg-surface-container-highest text-on-surface font-medium py-2 px-6 rounded-xl">Cancelar</button>
                </div>
             </div>
          )}

          <div className="space-y-4">
            {services.map(s => (
               <div key={s.id} className="bg-background border border-primary-container p-4 rounded-[16px] flex justify-between items-center">
                  <div>
                    <h4 className="font-sans font-medium text-[15px] text-primary mb-1">{s.name}</h4>
                    <span className="text-[12px] text-on-surface-variant font-light">{s.durationMinutes} min • ${s.price.toLocaleString('es-AR')}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingService(s)} className="p-2 text-primary-dim hover:text-primary transition-colors bg-primary-container rounded-lg"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                    <button onClick={() => deleteService(s.id)} className="p-2 text-error bg-error-container rounded-lg"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                  </div>
               </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'turnos' && (
         <div className="space-y-4">
           {appointments.sort((a,b) => new Date(`${b.date}T${b.startTime}`).getTime() - new Date(`${a.date}T${a.startTime}`).getTime()).map(appt => (
             <div key={appt.id} className={`p-4 rounded-[16px] border ${appt.status === 'pending' ? 'bg-background border-outline-variant shadow-sm' : appt.status === 'confirmed' ? 'bg-primary-container border-primary-dim' : 'bg-surface-container-highest border-transparent opacity-60'}`}>
                <div className="flex justify-between items-start mb-2">
                   <div>
                     <p className="font-serif text-[18px] tracking-tight text-primary">{appt.clientFirstName} {appt.clientLastName}</p>
                     <p className="text-[13px] text-on-surface-variant font-medium">{appt.serviceName}</p>
                   </div>
                   <div className="text-right">
                     <p className="font-bold text-[14px] text-primary">{format(new Date(appt.date), 'dd/MM/yyyy')}</p>
                     <p className="text-[12px] text-on-surface-variant font-medium">{appt.startTime} - {appt.endTime}</p>
                   </div>
                </div>
                <div className="flex justify-between items-center mt-4">
                   <span className="text-[10px] uppercase tracking-[2px] font-bold px-2 py-1 rounded bg-white text-primary">
                     {appt.status}
                   </span>
                   {appt.status === 'pending' && (
                     <div className="flex gap-2">
                       <button onClick={() => actAppt(appt.id, 'confirmed')} className="text-xs bg-primary-dim text-white font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">Confirmar</button>
                       <button onClick={() => actAppt(appt.id, 'cancelled')} className="text-xs bg-white text-on-surface border border-outline-variant font-medium px-4 py-2 rounded-lg hover:bg-surface-container-highest transition-colors">Cancelar</button>
                     </div>
                   )}
                </div>
             </div>
           ))}
           {appointments.length === 0 && <p className="text-on-surface-variant bg-white border border-outline-variant rounded-xl p-4 text-center">No hay turnos registrados.</p>}
         </div>
      )}
    </Layout>
  );
}

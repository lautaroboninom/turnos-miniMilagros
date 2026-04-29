import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { db, auth, loginWithEmail, registerWithEmail, logout, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { Service, Appointment, GalleryImage, StudioSettings } from '../types';
import { format } from 'date-fns';

const DEFAULT_GALLERY_IMAGES: GalleryImage[] = [
  { src: 'https://picsum.photos/seed/nails1/400/500', alt: 'Manicura' },
  { src: 'https://picsum.photos/seed/lashes1/400/400', alt: 'Pestanas' },
  { src: 'https://picsum.photos/seed/facial1/400/600', alt: 'Facial' },
  { src: 'https://picsum.photos/seed/spa1/400/400', alt: 'Spa' },
];

type EditingService = Partial<Omit<Service, 'durationMinutes' | 'price'>> & {
  durationMinutes?: string;
  price?: string;
};

const toEditingService = (service?: Service): EditingService => ({
  ...(service || {}),
  durationMinutes: service?.durationMinutes != null ? String(service.durationMinutes) : '',
  price: service?.price != null ? String(service.price) : '',
  isActive: service?.isActive ?? true,
});

const parseLocalizedNumber = (value?: string) => {
  const trimmed = (value || '').trim().replace(/\s+/g, '');
  if (!trimmed) return null;

  const lastComma = trimmed.lastIndexOf(',');
  const lastDot = trimmed.lastIndexOf('.');
  let normalized = trimmed;

  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = trimmed.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

export default function Admin() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.currentUser);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [settings, setSettings] = useState<StudioSettings>({
    depositAmount: 0,
    updatedAt: new Date().toISOString(),
    galleryImages: DEFAULT_GALLERY_IMAGES,
  });
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
      if (!snap.exists()) return;
      const data = snap.data() as StudioSettings;
      const nextGallery = Array.isArray(data.galleryImages)
        ? data.galleryImages
          .filter((img): img is GalleryImage => typeof img?.src === 'string')
          .map((img) => ({ src: img.src.trim(), alt: typeof img.alt === 'string' ? img.alt : '' }))
          .filter((img) => img.src.length > 0)
        : [];

      setSettings({
        depositAmount: typeof data.depositAmount === 'number' ? data.depositAmount : 0,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
        galleryImages: nextGallery.length > 0 ? nextGallery : DEFAULT_GALLERY_IMAGES,
      });
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/global'));

    return () => {
      unsubServices();
      unsubAppts();
      unsubSettings();
    };
  }, [user]);

  const [editingService, setEditingService] = useState<EditingService | null>(null);
  const [savingService, setSavingService] = useState(false);
  const [serviceSaveError, setServiceSaveError] = useState('');

  const saveService = async () => {
    if (!editingService) return;

    const name = (editingService.name || '').trim();
    const durationMinutes = parseLocalizedNumber(editingService.durationMinutes);
    const price = parseLocalizedNumber(editingService.price);

    if (!name) {
      setServiceSaveError('Completá el nombre del servicio.');
      return;
    }

    if (durationMinutes === null || durationMinutes <= 0) {
      setServiceSaveError('La duración debe ser un número mayor a 0.');
      return;
    }

    if (price === null || price < 0) {
      setServiceSaveError('El precio debe ser un número válido.');
      return;
    }

    const serviceData = {
      name,
      durationMinutes: Math.round(durationMinutes),
      price: roundCurrency(price),
      isActive: editingService.isActive ?? true,
    };

    try {
      setSavingService(true);
      setServiceSaveError('');
      if (editingService.id) {
        await updateDoc(doc(db, 'services', editingService.id), serviceData);
      } else {
        await addDoc(collection(db, 'services'), {
          ...serviceData,
          createdAt: new Date().toISOString(),
        });
      }
      setEditingService(null);
    } catch (e) {
      setServiceSaveError('No se pudo guardar el servicio. Revisá permisos o conexión e intentá de nuevo.');
      try {
        handleFirestoreError(e, OperationType.WRITE, 'services');
      } catch {
        // Keep the admin panel open after logging the Firestore context.
      }
    } finally {
      setSavingService(false);
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
    const normalizedGallery = (settings.galleryImages ?? [])
      .map((img) => ({ src: (img.src ?? '').trim(), alt: (img.alt ?? '').trim() || 'Trabajo' }))
      .filter((img) => img.src.length > 0);

    if (normalizedGallery.length === 0) {
      alert('Agrega al menos una imagen con URL valida en "Nuestros Trabajos".');
      return;
    }

    const nextSettings: StudioSettings = {
      depositAmount: settings.depositAmount,
      galleryImages: normalizedGallery,
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'settings', 'global'), nextSettings);
      setSettings(nextSettings);
      alert('Configuracion guardada');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'settings/global');
    }
  };

  const updateGalleryImage = (index: number, key: keyof GalleryImage, value: string) => {
    const currentGallery = [...(settings.galleryImages ?? [])];
    if (!currentGallery[index]) return;
    currentGallery[index] = { ...currentGallery[index], [key]: value };
    setSettings({ ...settings, galleryImages: currentGallery });
  };

  const addGalleryImage = () => {
    const currentGallery = [...(settings.galleryImages ?? [])];
    setSettings({ ...settings, galleryImages: [...currentGallery, { src: '', alt: '' }] });
  };

  const removeGalleryImage = (index: number) => {
    const currentGallery = [...(settings.galleryImages ?? [])];
    if (currentGallery.length <= 1) {
      alert('Debe quedar al menos una imagen.');
      return;
    }
    currentGallery.splice(index, 1);
    setSettings({ ...settings, galleryImages: currentGallery });
  };

  const actAppt = async (id: string, status: 'confirmed' | 'cancelled') => {
    try {
      await updateDoc(doc(db, 'appointments', id), { status });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `appointments/${id}`);
    }
  };

  const populateBaseData = async () => {
    const baseServices = [
      { name: 'Esmaltado', durationMinutes: 35, price: 5000 },
      { name: 'Kapping', durationMinutes: 60, price: 7000 },
      { name: 'Esculpidas basicas', durationMinutes: 90, price: 10000 },
      { name: 'Full set', durationMinutes: 120, price: 15000 },
      { name: 'Depilacion definitiva', durationMinutes: 30, price: 4000 },
      { name: 'Full cejas', durationMinutes: 60, price: 6000 },
      { name: 'Lifting de pestanas', durationMinutes: 60, price: 8000 },
      { name: 'Belleza de pies', durationMinutes: 60, price: 7500 },
      { name: 'Tratamientos capilares', durationMinutes: 90, price: 12000 },
      { name: 'Hidra lips', durationMinutes: 45, price: 9000 },
    ];
    for (const bs of baseServices) {
      await addDoc(collection(db, 'services'), { ...bs, isActive: true, createdAt: new Date().toISOString() });
    }
    alert('Servicios base cargados');
  };

  const handleLogin = async (e: FormEvent) => {
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
            alert("Para ingresar, debes habilitar el proveedor 'Correo electronico/Contrasena' en Firebase.");
          }
        } else {
          alert('Credenciales incorrectas');
        }
      } else {
        alert("Asegurate de tener habilitado 'Correo electronico/Contrasena' en Firebase Authentication.");
      }
    }
  };

  if (!user) {
    return (
      <Layout>
        <div className="text-center py-10 bg-background border border-primary-container rounded-[20px] shadow-sm max-w-sm mx-auto">
          <h1 className="text-[24px] font-serif text-primary mb-6">Acceso a Gestor</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4 px-6 mb-4">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Tu Email" required />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Contrasena" required />
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
        <h1 className="text-2xl font-serif text-primary">Panel Dinamico</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-sm text-on-surface-variant font-medium underline">Ir al inicio</button>
          <button onClick={logout} className="text-sm text-on-surface-variant font-medium underline">Salir</button>
        </div>
      </div>

      <div className="flex gap-4 mb-8 overflow-x-auto pb-2 no-scrollbar">
        <button onClick={() => setTab('turnos')} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === 'turnos' ? 'bg-primary-container text-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant'}`}>
          Turnos
        </button>
        <button onClick={() => setTab('servicios')} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === 'servicios' ? 'bg-primary-container text-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant'}`}>
          Servicios
        </button>
        <button onClick={() => setTab('config')} className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === 'config' ? 'bg-primary-container text-primary shadow-sm' : 'bg-white border border-outline-variant text-on-surface-variant'}`}>
          Configuracion
        </button>
      </div>

      {tab === 'config' && (
        <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm">
          <h2 className="font-serif text-[18px] mb-4 text-primary">Monto de Sena (Fijo)</h2>
          <input
            type="number"
            value={settings.depositAmount}
            onChange={e => setSettings({ ...settings, depositAmount: Number(e.target.value) })}
            className="w-full mb-4 bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3"
          />

          <div className="mt-8 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-serif text-[18px] text-primary">Imagenes de Nuestros Trabajos</h3>
              <button onClick={addGalleryImage} className="bg-secondary-container text-on-secondary-container py-2 px-4 rounded-lg text-sm font-medium shadow-sm">
                + Agregar Imagen
              </button>
            </div>
            <div className="space-y-4">
              {(settings.galleryImages ?? []).map((img, index) => (
                <div key={index} className="border border-outline-variant rounded-xl p-4 bg-white">
                  <div className="flex justify-between items-center mb-3">
                    <p className="text-sm font-medium text-primary">Imagen {index + 1}</p>
                    <button onClick={() => removeGalleryImage(index)} className="text-xs bg-error-container text-error px-3 py-1 rounded-lg font-medium">
                      Quitar
                    </button>
                  </div>
                  <div className="space-y-3">
                    <input type="url" value={img.src} onChange={e => updateGalleryImage(index, 'src', e.target.value)} className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="URL de imagen (https://...)" />
                    <input type="text" value={img.alt} onChange={e => updateGalleryImage(index, 'alt', e.target.value)} className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Texto alternativo (ej. Manicura)" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={saveSettings} className="bg-primary-dim text-white py-3 px-6 rounded-xl font-medium w-full sm:w-auto">Guardar Configuracion</button>
        </div>
      )}

      {tab === 'servicios' && (
        <div>
          <div className="flex gap-4 mb-6">
            <button onClick={() => { setEditingService(toEditingService()); setServiceSaveError(''); }} className="bg-primary text-on-primary py-2 px-6 rounded-lg font-medium">
              + Nuevo Servicio
            </button>
            {services.length === 0 && (
              <button onClick={populateBaseData} className="bg-secondary-container text-on-secondary-container py-2 px-6 rounded-lg font-medium shadow-sm">
                Cargar Catalogo Base
              </button>
            )}
          </div>

          {editingService && (
            <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm mb-8">
              <h3 className="font-serif text-[18px] mb-4 text-primary">{editingService.id ? 'Editar' : 'Crear'} Servicio</h3>
              <div className="space-y-4 mb-4">
                {serviceSaveError && (
                  <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
                    {serviceSaveError}
                  </div>
                )}
                <input type="text" placeholder="Nombre (ej. Esmaltado)" value={editingService.name || ''} onChange={e => { setEditingService({ ...editingService, name: e.target.value }); setServiceSaveError(''); }} className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3" />
                <div className="flex gap-4">
                  <input type="text" inputMode="numeric" placeholder="Minutos (ej. 35)" value={editingService.durationMinutes || ''} onChange={e => { setEditingService({ ...editingService, durationMinutes: e.target.value }); setServiceSaveError(''); }} className="w-1/2 bg-white border border-outline-variant rounded-xl px-4 py-3" />
                  <input type="text" inputMode="decimal" placeholder="Precio ($)" value={editingService.price || ''} onChange={e => { setEditingService({ ...editingService, price: e.target.value }); setServiceSaveError(''); }} className="w-1/2 bg-white border border-outline-variant rounded-xl px-4 py-3" />
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editingService.isActive} onChange={e => setEditingService({ ...editingService, isActive: e.target.checked })} className="rounded text-primary focus:ring-primary" />
                  <span className="text-sm">Activo (visible)</span>
                </label>
              </div>
              <div className="flex gap-3">
                <button onClick={saveService} disabled={savingService} className="bg-primary-dim text-white font-medium py-2 px-6 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed">
                  {savingService ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => { setEditingService(null); setServiceSaveError(''); }} className="bg-surface-container-highest text-on-surface font-medium py-2 px-6 rounded-xl">Cancelar</button>
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
                  <button onClick={() => { setEditingService(toEditingService(s)); setServiceSaveError(''); }} className="p-2 text-primary-dim hover:text-primary transition-colors bg-primary-container rounded-lg"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                  <button onClick={() => deleteService(s.id)} className="p-2 text-error bg-error-container rounded-lg"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'turnos' && (
        <div className="space-y-4">
          {appointments.sort((a, b) => new Date(`${b.date}T${b.startTime}`).getTime() - new Date(`${a.date}T${a.startTime}`).getTime()).map(appt => (
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
                <span className="text-[10px] uppercase tracking-[2px] font-bold px-2 py-1 rounded bg-white text-primary">{appt.status}</span>
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

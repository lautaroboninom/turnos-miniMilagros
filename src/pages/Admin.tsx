import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import ShareWeekPreview from '../components/ShareWeekPreview';
import { db, auth, storage, loginWithEmail, logout, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  DEFAULT_EMPLOYEE_ID,
  DEFAULT_EMPLOYEE_NAME,
  Service,
  Appointment,
  Employee,
  GalleryImage,
  ShareBackgroundImageSourceType,
  StudioSettings,
} from '../types';
import { normalizeShareSlotTimes, SHARE_SLOT_TIMES } from '../lib/availability';
import { format } from 'date-fns';
import {
  DEFAULT_GALLERY_IMAGES,
  buildSettingsPayload,
  getShareSettingsValidationMessage,
  normalizeShareBackgroundOverlayOpacity,
  normalizeStudioSettings,
} from '../lib/studioSettings';

const DEFAULT_EMPLOYEE: Employee = {
  id: DEFAULT_EMPLOYEE_ID,
  name: DEFAULT_EMPLOYEE_NAME,
  createdAt: '',
  updatedAt: '',
};

const ADMIN_TABS = [
  { id: 'turnos', label: 'Turnos' },
  { id: 'compartir', label: 'Compartir' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'empleadas', label: 'Empleadas' },
  { id: 'config', label: 'Configuracion' },
] as const;

type AdminTabId = typeof ADMIN_TABS[number]['id'];

type EditingService = Partial<Omit<Service, 'durationMinutes' | 'price'>> & {
  durationMinutes?: string;
  price?: string;
};

type ImageInputMode = 'url' | 'upload';

type ServiceImageDraft = {
  mode: ImageInputMode;
  url: string;
  file: File | null;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const normalizeEmployeeName = (value: string) => value.trim().replace(/\s+/g, ' ');

const getEmployeeIdWithFallback = (source?: Pick<Service, 'employeeId'> | Pick<Appointment, 'employeeId'> | null) => {
  const employeeId = source?.employeeId?.trim();
  return employeeId || DEFAULT_EMPLOYEE_ID;
};

const getEmployeeNameWithFallback = (source?: Pick<Service, 'employeeName'> | Pick<Appointment, 'employeeName'> | null) => {
  const employeeName = source?.employeeName?.trim();
  return employeeName || DEFAULT_EMPLOYEE_NAME;
};

const withDefaultEmployee = (sourceEmployees: Employee[]) => {
  const byId = new Map<string, Employee>();
  byId.set(DEFAULT_EMPLOYEE_ID, DEFAULT_EMPLOYEE);

  sourceEmployees.forEach((employee) => {
    const name = normalizeEmployeeName(employee.name || '');
    if (!name) return;

    byId.set(employee.id, {
      ...employee,
      name: employee.id === DEFAULT_EMPLOYEE_ID ? DEFAULT_EMPLOYEE_NAME : name,
    });
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (a.id === DEFAULT_EMPLOYEE_ID) return -1;
    if (b.id === DEFAULT_EMPLOYEE_ID) return 1;
    return a.name.localeCompare(b.name);
  });
};

const toEditingService = (service?: Service): EditingService => ({
  ...(service || {}),
  durationMinutes: service?.durationMinutes != null ? String(service.durationMinutes) : '',
  price: service?.price != null ? String(service.price) : '',
  isActive: service?.isActive ?? true,
  employeeId: getEmployeeIdWithFallback(service),
  employeeName: getEmployeeNameWithFallback(service),
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

const getInitialImageDraft = (service: Service): ServiceImageDraft => ({
  mode: service.imageSourceType === 'upload' ? 'upload' : 'url',
  url: service.imageUrl || '',
  file: null,
});

const isValidHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const getFileExtension = (file: File) => {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && ['jpg', 'jpeg', 'png', 'webp'].includes(fromName)) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
};

const makeSafePathSegment = (value: string) => (
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'servicio'
);

const getSettingsSaveErrorMessage = (error: any) => {
  if (error?.code === 'permission-denied') {
    return 'No tenes permisos para guardar la configuracion. Revisa las reglas de Firestore.';
  }

  if (error?.code === 'unavailable') {
    return 'Firebase no esta disponible ahora. Revisa la conexion e intenta de nuevo.';
  }

  return 'No se pudo guardar la configuracion. Revisa la conexion e intenta de nuevo.';
};

export default function Admin() {
  const navigate = useNavigate();
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const [user, setUser] = useState(auth.currentUser);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([DEFAULT_EMPLOYEE]);
  const [settings, setSettings] = useState<StudioSettings>(normalizeStudioSettings({
    depositAmount: 0,
    updatedAt: new Date().toISOString(),
    galleryImages: DEFAULT_GALLERY_IMAGES,
    shareSlotTimes: [...SHARE_SLOT_TIMES],
  }));
  const [tab, setTab] = useState<AdminTabId>('turnos');
  const [email, setEmail] = useState('milagros@minimilagros.com');
  const [password, setPassword] = useState('');
  const [uploadingGalleryIndex, setUploadingGalleryIndex] = useState<number | null>(null);
  const [uploadingShareBackground, setUploadingShareBackground] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaveError, setSettingsSaveError] = useState('');
  const [settingsSaveNotice, setSettingsSaveNotice] = useState('');
  const [savingShareSettings, setSavingShareSettings] = useState(false);
  const [shareSettingsSaveError, setShareSettingsSaveError] = useState('');
  const [shareSettingsSaveNotice, setShareSettingsSaveNotice] = useState('');
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeNameDraft, setEmployeeNameDraft] = useState('');
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [employeeSaveError, setEmployeeSaveError] = useState('');
  const [employeeSaveNotice, setEmployeeSaveNotice] = useState('');

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(u => setUser(u));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    const activeTabButton = tabBarRef.current?.querySelector<HTMLElement>(`[data-admin-tab="${tab}"]`);
    activeTabButton?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [tab]);

  useEffect(() => {
    if (!user) return;

    const ensureDefaultEmployee = async () => {
      const employeeRef = doc(db, 'employees', DEFAULT_EMPLOYEE_ID);
      const now = new Date().toISOString();

      try {
        const employeeSnap = await getDoc(employeeRef);
        if (!employeeSnap.exists()) {
          await setDoc(employeeRef, {
            name: DEFAULT_EMPLOYEE_NAME,
            createdAt: now,
            updatedAt: now,
          });
          return;
        }

        if (employeeSnap.data().name !== DEFAULT_EMPLOYEE_NAME) {
          await updateDoc(employeeRef, {
            name: DEFAULT_EMPLOYEE_NAME,
            updatedAt: now,
          });
        }
      } catch (e) {
        try {
          handleFirestoreError(e, OperationType.WRITE, 'employees/milagros');
        } catch {
          // Keep the panel available even if seeding the default employee fails.
        }
      }
    };

    void ensureDefaultEmployee();

    const unsubServices = onSnapshot(collection(db, 'services'), snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Service)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'services'));

    const unsubAppts = onSnapshot(query(collection(db, 'appointments')), snap => {
      setAppointments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Appointment)));
    }, err => handleFirestoreError(err, OperationType.LIST, 'appointments'));

    const unsubEmployees = onSnapshot(collection(db, 'employees'), snap => {
      setEmployees(withDefaultEmployee(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee))));
    }, err => handleFirestoreError(err, OperationType.LIST, 'employees'));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), snap => {
      if (!snap.exists()) return;
      const data = snap.data() as StudioSettings;
      setSettings(normalizeStudioSettings(data));
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/global'));

    return () => {
      unsubServices();
      unsubAppts();
      unsubEmployees();
      unsubSettings();
    };
  }, [user]);

  const [editingService, setEditingService] = useState<EditingService | null>(null);
  const [savingService, setSavingService] = useState(false);
  const [serviceSaveError, setServiceSaveError] = useState('');
  const [serviceImageDrafts, setServiceImageDrafts] = useState<Record<string, ServiceImageDraft>>({});
  const [savingImageFor, setSavingImageFor] = useState<string | null>(null);
  const [serviceImageErrors, setServiceImageErrors] = useState<Record<string, string>>({});
  const [serviceImageNotice, setServiceImageNotice] = useState('');
  const employeeOptions = withDefaultEmployee(employees);

  const findEmployee = (employeeId?: string) => (
    employeeOptions.find((employee) => employee.id === (employeeId || DEFAULT_EMPLOYEE_ID))
  );

  const getServiceAssignedEmployeeName = (service: Service) => {
    const employeeId = getEmployeeIdWithFallback(service);
    return findEmployee(employeeId)?.name || getEmployeeNameWithFallback(service);
  };

  const beginEmployeeEdit = (employee: Employee) => {
    if (employee.id === DEFAULT_EMPLOYEE_ID) return;
    setEditingEmployeeId(employee.id);
    setEmployeeNameDraft(employee.name);
    setEmployeeSaveError('');
    setEmployeeSaveNotice('');
  };

  const resetEmployeeForm = () => {
    setEditingEmployeeId(null);
    setEmployeeNameDraft('');
    setEmployeeSaveError('');
    setEmployeeSaveNotice('');
  };

  const saveEmployee = async () => {
    const name = normalizeEmployeeName(employeeNameDraft);

    if (!name) {
      setEmployeeSaveError('Completa el nombre de la empleada.');
      return;
    }

    const duplicateEmployee = employeeOptions.find((employee) => (
      employee.id !== editingEmployeeId &&
      employee.name.trim().toLowerCase() === name.toLowerCase()
    ));

    if (duplicateEmployee) {
      setEmployeeSaveError('Ya existe una empleada con ese nombre.');
      return;
    }

    try {
      setSavingEmployee(true);
      setEmployeeSaveError('');
      setEmployeeSaveNotice('');

      const now = new Date().toISOString();
      if (editingEmployeeId) {
        if (editingEmployeeId === DEFAULT_EMPLOYEE_ID) return;

        await updateDoc(doc(db, 'employees', editingEmployeeId), {
          name,
          updatedAt: now,
        });

        await Promise.all(
          services
            .filter((service) => getEmployeeIdWithFallback(service) === editingEmployeeId)
            .map((service) => updateDoc(doc(db, 'services', service.id), { employeeName: name }))
        );

        setEmployeeSaveNotice('Empleada actualizada.');
      } else {
        await addDoc(collection(db, 'employees'), {
          name,
          createdAt: now,
          updatedAt: now,
        });
        setEmployeeSaveNotice('Empleada creada.');
      }

      setEditingEmployeeId(null);
      setEmployeeNameDraft('');
    } catch (e) {
      setEmployeeSaveError('No se pudo guardar la empleada. Revisa permisos o conexion e intenta de nuevo.');
      try {
        handleFirestoreError(e, OperationType.WRITE, 'employees');
      } catch {
        // Keep the employee form available after logging the Firestore context.
      }
    } finally {
      setSavingEmployee(false);
    }
  };

  const deleteEmployee = async (employee: Employee) => {
    if (employee.id === DEFAULT_EMPLOYEE_ID) return;

    const assignedServicesCount = services.filter((service) => getEmployeeIdWithFallback(service) === employee.id).length;
    if (assignedServicesCount > 0) {
      alert('No se puede eliminar una empleada asignada a servicios.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'employees', employee.id));
      if (editingEmployeeId === employee.id) resetEmployeeForm();
      setEmployeeSaveNotice('Empleada eliminada.');
    } catch (e) {
      setEmployeeSaveError('No se pudo eliminar la empleada. Revisa permisos o conexion e intenta de nuevo.');
      try {
        handleFirestoreError(e, OperationType.DELETE, `employees/${employee.id}`);
      } catch {
        // Keep the employee list available after logging the Firestore context.
      }
    }
  };

  useEffect(() => {
    setServiceImageDrafts((current) => {
      const next = { ...current };
      const serviceIds = new Set(services.map((service) => service.id));

      services.forEach((service) => {
        if (!next[service.id]) {
          next[service.id] = getInitialImageDraft(service);
        }
      });

      Object.keys(next).forEach((serviceId) => {
        if (!serviceIds.has(serviceId)) {
          delete next[serviceId];
        }
      });

      return next;
    });
  }, [services]);

  const updateServiceImageDraft = (serviceId: string, patch: Partial<ServiceImageDraft>) => {
    setServiceImageDrafts((current) => ({
      ...current,
      [serviceId]: {
        ...(current[serviceId] || { mode: 'url', url: '', file: null }),
        ...patch,
      },
    }));
    setServiceImageErrors((current) => ({ ...current, [serviceId]: '' }));
    setServiceImageNotice('');
  };

  const setServiceImageError = (serviceId: string, message: string) => {
    setServiceImageErrors((current) => ({ ...current, [serviceId]: message }));
  };

  const saveServiceImage = async (service: Service) => {
    const draft = serviceImageDrafts[service.id] || getInitialImageDraft(service);

    try {
      setSavingImageFor(service.id);
      setServiceImageError(service.id, '');
      setServiceImageNotice('');

      if (draft.mode === 'url') {
        const imageUrl = draft.url.trim();

        if (!imageUrl || !isValidHttpUrl(imageUrl)) {
          setServiceImageError(service.id, 'Ingresa un link valido que empiece con http:// o https://.');
          return;
        }

        await updateDoc(doc(db, 'services', service.id), {
          imageUrl,
          imageSourceType: 'url',
          imageStoragePath: '',
          imageUpdatedAt: new Date().toISOString(),
        });

        setServiceImageDrafts((current) => ({
          ...current,
          [service.id]: { mode: 'url', url: imageUrl, file: null },
        }));
        setServiceImageNotice(`Imagen de ${service.name} guardada.`);
        return;
      }

      if (!draft.file) {
        setServiceImageError(service.id, 'Selecciona una foto para subir.');
        return;
      }

      if (!ALLOWED_IMAGE_TYPES.has(draft.file.type)) {
        setServiceImageError(service.id, 'Subi una imagen JPG, PNG o WEBP.');
        return;
      }

      if (draft.file.size > MAX_IMAGE_SIZE) {
        setServiceImageError(service.id, 'La imagen no puede superar 5 MB.');
        return;
      }

      const storagePath = `service-images/${service.id}/${Date.now()}-${makeSafePathSegment(service.name)}.${getFileExtension(draft.file)}`;
      const imageRef = ref(storage, storagePath);
      await uploadBytes(imageRef, draft.file, { contentType: draft.file.type });
      const imageUrl = await getDownloadURL(imageRef);

      await updateDoc(doc(db, 'services', service.id), {
        imageUrl,
        imageSourceType: 'upload',
        imageStoragePath: storagePath,
        imageUpdatedAt: new Date().toISOString(),
      });

      setServiceImageDrafts((current) => ({
        ...current,
        [service.id]: { mode: 'upload', url: imageUrl, file: null },
      }));
      setServiceImageNotice(`Imagen de ${service.name} subida y guardada.`);
    } catch (error: any) {
      console.error(error);
      const isPermissionError = error?.code === 'storage/unauthorized' || error?.code === 'permission-denied';
      setServiceImageError(
        service.id,
        isPermissionError
          ? 'No tenes permisos para guardar esta imagen. Revisa reglas de Storage y Firestore.'
          : 'No se pudo guardar la imagen. Revisa la conexion e intenta de nuevo.'
      );
    } finally {
      setSavingImageFor(null);
    }
  };

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

    const selectedEmployee = findEmployee(editingService.employeeId) || DEFAULT_EMPLOYEE;
    const serviceData = {
      name,
      durationMinutes: Math.round(durationMinutes),
      price: roundCurrency(price),
      isActive: editingService.isActive ?? true,
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
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

  const clearSettingsFeedback = () => {
    setSettingsSaveError('');
    setSettingsSaveNotice('');
  };

  const clearShareFeedback = () => {
    setShareSettingsSaveError('');
    setShareSettingsSaveNotice('');
  };

  const clearAllSettingsFeedback = () => {
    clearSettingsFeedback();
    clearShareFeedback();
  };

  const updateSettingsState = (updater: (previous: StudioSettings) => StudioSettings) => {
    clearAllSettingsFeedback();
    setSettings((previous) => updater(previous));
  };

  const persistSettings = async (
    sourceSettings: StudioSettings,
    successMessage: string | undefined,
    saveContext: 'config' | 'share' = 'config',
  ) => {
    const shareValidationError = getShareSettingsValidationMessage(sourceSettings);

    if (shareValidationError) {
      if (saveContext === 'share') {
        clearShareFeedback();
        setShareSettingsSaveError(shareValidationError);
      } else {
        clearSettingsFeedback();
        setSettingsSaveError(shareValidationError);
      }
      return false;
    }

    const normalizedSource = normalizeStudioSettings(sourceSettings);

    if (
      normalizedSource.shareBackgroundImageSourceType === 'url' &&
      normalizedSource.shareBackgroundImageUrl?.trim() &&
      !isValidHttpUrl(normalizedSource.shareBackgroundImageUrl)
    ) {
      const message = 'Ingresa un link valido para el fondo que empiece con http:// o https://.';
      if (saveContext === 'share') {
        clearShareFeedback();
        setShareSettingsSaveError(message);
      } else {
        clearSettingsFeedback();
        setSettingsSaveError(message);
      }
      return false;
    }

    const nextSettings = buildSettingsPayload(normalizedSource);

    try {
      if (saveContext === 'share') {
        setSavingShareSettings(true);
        clearShareFeedback();
      } else {
        setSavingSettings(true);
        clearSettingsFeedback();
      }
      await setDoc(doc(db, 'settings', 'global'), nextSettings);
      setSettings(normalizeStudioSettings(nextSettings));
      if (successMessage) {
        if (saveContext === 'share') {
          setShareSettingsSaveNotice(successMessage);
        } else {
          setSettingsSaveNotice(successMessage);
        }
      }
      return true;
    } catch (e: any) {
      console.error('Settings save error', e);
      const message = getSettingsSaveErrorMessage(e);
      if (saveContext === 'share') {
        setShareSettingsSaveError(message);
      } else {
        setSettingsSaveError(message);
      }
      try {
        handleFirestoreError(e, OperationType.WRITE, 'settings/global');
      } catch {
        // Keep the admin panel open while still logging the Firestore context.
      }
      return false;
    } finally {
      if (saveContext === 'share') {
        setSavingShareSettings(false);
      } else {
        setSavingSettings(false);
      }
    }
  };

  const saveSettings = async () => {
    const saved = await persistSettings(settings, 'Configuracion guardada.', 'config');
    if (saved) alert('Configuracion guardada');
  };

  const updateShareSlotTimes = (slotTimes: string[]) => {
    updateSettingsState((previous) => ({
      ...previous,
      shareSlotTimes: normalizeShareSlotTimes(slotTimes),
    }));
  };

  const updateAvailabilityWindow = (window: { startTime: string; endTime: string }) => {
    updateSettingsState((previous) => ({
      ...previous,
      availabilityStartTime: window.startTime,
      availabilityEndTime: window.endTime,
    }));
  };

  const updateShareBackgroundImage = (nextBackground: {
    imageUrl: string;
    sourceType: ShareBackgroundImageSourceType;
    storagePath?: string;
  }) => {
    updateSettingsState((previous) => ({
      ...previous,
      shareBackgroundImageUrl: nextBackground.imageUrl,
      shareBackgroundImageSourceType: nextBackground.imageUrl.trim()
        ? nextBackground.sourceType
        : undefined,
      shareBackgroundImageStoragePath: nextBackground.storagePath ?? '',
    }));
  };

  const updateShareBackgroundOverlayOpacity = (opacity: number) => {
    updateSettingsState((previous) => ({
      ...previous,
      shareBackgroundOverlayOpacity: normalizeShareBackgroundOverlayOpacity(opacity),
    }));
  };

  const saveShareSettings = async () => {
    await persistSettings(settings, 'Compartir guardado.', 'share');
  };

  const updateGalleryImage = (index: number, key: keyof GalleryImage, value: string) => {
    updateSettingsState((prev) => {
      const currentGallery = [...(prev.galleryImages ?? [])];
      if (!currentGallery[index]) return prev;
      currentGallery[index] = { ...currentGallery[index], [key]: value };
      return { ...prev, galleryImages: currentGallery };
    });
  };

  const addGalleryImage = () => {
    updateSettingsState((prev) => {
      const currentGallery = [...(prev.galleryImages ?? [])];
      return { ...prev, galleryImages: [...currentGallery, { src: '', alt: '' }] };
    });
  };

  const removeGalleryImage = (index: number) => {
    if ((settings.galleryImages ?? []).length <= 1) {
      alert('Debe quedar al menos una imagen.');
      return;
    }

    updateSettingsState((prev) => {
      const currentGallery = [...(prev.galleryImages ?? [])];
      currentGallery.splice(index, 1);
      return { ...prev, galleryImages: currentGallery };
    });
  };

  const uploadGalleryImage = async (index: number, file: File | null) => {
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      alert('Subi una imagen JPG, PNG o WEBP.');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      alert('La imagen no puede superar 5 MB.');
      return;
    }

    setUploadingGalleryIndex(index);

    try {
      const baseName = file.name.replace(/\.[^.]+$/, '') || `trabajo-${index + 1}`;
      const storagePath = `gallery/${Date.now()}-${makeSafePathSegment(baseName)}.${getFileExtension(file)}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const downloadUrl = await getDownloadURL(storageRef);

      const nextGallery = [...(settings.galleryImages ?? [])];
      const currentAlt = settings.galleryImages?.[index]?.alt?.trim() ?? '';
      nextGallery[index] = {
        ...(nextGallery[index] ?? { src: '', alt: '' }),
        src: downloadUrl,
        alt: currentAlt || baseName.trim() || `Trabajo ${index + 1}`,
      };

      const saved = await persistSettings(
        { ...settings, galleryImages: nextGallery },
        'Imagen subida y guardada automaticamente.',
        'config',
      );

      if (!saved) {
        alert('La imagen se subio, pero no se pudo guardar en la configuracion. Usa Guardar Configuracion para reintentar.');
      }
    } catch (e) {
      console.error('Gallery upload error', e);
      alert('No se pudo subir la imagen. Verifica Firebase Storage e intenta nuevamente.');
    } finally {
      setUploadingGalleryIndex(null);
    }
  };

  const uploadShareBackgroundImage = async (file: File | null) => {
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      clearAllSettingsFeedback();
      setShareSettingsSaveError('Subi una imagen JPG, PNG o WEBP.');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      clearAllSettingsFeedback();
      setShareSettingsSaveError('La imagen no puede superar 5 MB.');
      return;
    }

    setUploadingShareBackground(true);
    clearAllSettingsFeedback();

    try {
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'fondo-compartir';
      const storagePath = `share-background/${Date.now()}-${makeSafePathSegment(baseName)}.${getFileExtension(file)}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const downloadUrl = await getDownloadURL(storageRef);

      setSettings((previous) => ({
        ...previous,
        shareBackgroundImageUrl: downloadUrl,
        shareBackgroundImageSourceType: 'upload',
        shareBackgroundImageStoragePath: storagePath,
      }));
      setShareSettingsSaveNotice('Fondo subido. Falta guardar Compartir para publicarlo.');
    } catch (error: any) {
      console.error('Share background upload error', error);
      const isPermissionError = error?.code === 'storage/unauthorized' || error?.code === 'permission-denied';
      setShareSettingsSaveError(
        isPermissionError
          ? 'No tenes permisos para guardar esta imagen. Revisa reglas de Storage y Firestore.'
          : 'No se pudo subir el fondo. Revisa la conexion e intenta de nuevo.',
      );
    } finally {
      setUploadingShareBackground(false);
    }
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
      await addDoc(collection(db, 'services'), {
        ...bs,
        employeeId: DEFAULT_EMPLOYEE_ID,
        employeeName: DEFAULT_EMPLOYEE_NAME,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
    }
    alert('Servicios base cargados');
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;

    try {
      await loginWithEmail(normalizedEmail, password);
    } catch (err: any) {
      console.error('Login error', err);

      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        alert('Email o contrasena incorrectos. Revisa los datos o restablece la clave desde Firebase Authentication.');
        return;
      }

      if (err.code === 'auth/operation-not-allowed') {
        alert("Para ingresar, habilita el proveedor 'Correo electronico/Contrasena' en Firebase Authentication.");
        return;
      }

      if (err.code === 'auth/too-many-requests') {
        alert('Firebase bloqueo temporalmente los intentos de ingreso. Espera unos minutos y proba de nuevo.');
        return;
      }

      alert('No se pudo ingresar. Revisa la conexion e intenta nuevamente.');
    }
  };

  const goToAdjacentTab = (direction: -1 | 1) => {
    const currentIndex = ADMIN_TABS.findIndex((adminTab) => adminTab.id === tab);
    const nextIndex = (currentIndex + direction + ADMIN_TABS.length) % ADMIN_TABS.length;
    setTab(ADMIN_TABS[nextIndex].id);
  };

  if (!user) {
    return (
      <Layout>
        <div className="text-center py-10 bg-background border border-primary-container rounded-[20px] shadow-sm max-w-sm mx-auto">
          <h1 className="text-[24px] font-serif text-primary mb-6">Acceso a Gestor</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4 px-6 mb-4">
            <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Tu Email" required />
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Contrasena" required />
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

      <div className="mb-8 rounded-[18px] border border-outline-variant bg-white p-2 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Pestana anterior"
            title="Pestana anterior"
            onClick={() => goToAdjacentTab(-1)}
            className="h-10 w-10 shrink-0 rounded-xl border border-outline-variant bg-background text-primary flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[22px]">chevron_left</span>
          </button>
          <div ref={tabBarRef} className="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth no-scrollbar">
            {ADMIN_TABS.map((adminTab) => (
              <button
                key={adminTab.id}
                type="button"
                data-admin-tab={adminTab.id}
                onClick={() => setTab(adminTab.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${tab === adminTab.id ? 'bg-primary-container text-primary shadow-sm' : 'bg-background border border-outline-variant text-on-surface-variant'}`}
              >
                {adminTab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Pestana siguiente"
            title="Pestana siguiente"
            onClick={() => goToAdjacentTab(1)}
            className="h-10 w-10 shrink-0 rounded-xl border border-outline-variant bg-background text-primary flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-[22px]">chevron_right</span>
          </button>
        </div>
      </div>

      {tab === 'compartir' && (
        <ShareWeekPreview
          services={services}
          appointments={appointments}
          galleryImages={settings.galleryImages}
          slotTimes={settings.shareSlotTimes}
          availabilityStartTime={settings.availabilityStartTime}
          availabilityEndTime={settings.availabilityEndTime}
          shareBackgroundImageUrl={settings.shareBackgroundImageUrl}
          shareBackgroundImageSourceType={settings.shareBackgroundImageSourceType}
          shareBackgroundOverlayOpacity={settings.shareBackgroundOverlayOpacity}
          onSlotTimesChange={updateShareSlotTimes}
          onAvailabilityWindowChange={updateAvailabilityWindow}
          onShareBackgroundImageChange={updateShareBackgroundImage}
          onShareBackgroundOverlayOpacityChange={updateShareBackgroundOverlayOpacity}
          onShareBackgroundUpload={uploadShareBackgroundImage}
          uploadingBackgroundImage={uploadingShareBackground}
          onSaveShareSettings={saveShareSettings}
          savingShareSettings={savingShareSettings}
          shareSettingsSaveNotice={shareSettingsSaveNotice}
          shareSettingsSaveError={shareSettingsSaveError}
          shareSettingsValidationError={getShareSettingsValidationMessage(settings)}
        />
      )}

      {tab === 'config' && (
        <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm space-y-8">
          <section>
            <h2 className="font-serif text-[18px] mb-4 text-primary">Monto de Sena (Fijo)</h2>
            <input
              type="number"
              min="0"
              value={settings.depositAmount}
              onChange={e => updateSettingsState((previous) => ({
                ...previous,
                depositAmount: Number(e.target.value),
              }))}
              className="w-full mb-4 bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3"
            />
          </section>

          <section className="border-t border-outline-variant pt-8">
            <div className="mb-4">
              <h2 className="font-serif text-[18px] text-primary">Disponibilidad</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Este rango aplica tanto a la reserva publica como a la placa de Compartir.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-primary">Inicio</span>
                <input
                  data-settings-field="availability-start-time"
                  type="time"
                  step="900"
                  value={settings.availabilityStartTime ?? '08:00'}
                  onChange={e => updateAvailabilityWindow({
                    startTime: e.target.value,
                    endTime: settings.availabilityEndTime ?? '19:00',
                  })}
                  className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-on-surface focus:border-primary focus:ring-0"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-primary">Cierre real</span>
                <input
                  data-settings-field="availability-end-time"
                  type="time"
                  step="900"
                  value={settings.availabilityEndTime ?? '19:00'}
                  onChange={e => updateAvailabilityWindow({
                    startTime: settings.availabilityStartTime ?? '08:00',
                    endTime: e.target.value,
                  })}
                  className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-on-surface focus:border-primary focus:ring-0"
                />
              </label>
            </div>
          </section>

          <section className="border-t border-outline-variant pt-8">
            <div className="flex items-center justify-between mb-4 gap-4">
              <div>
                <h2 className="font-serif text-[18px] text-primary">Nuestros Trabajos</h2>
                <p className="text-sm text-on-surface-variant mt-1">Las imagenes que cargues aca son las que se muestran en el inicio. Podes subir una foto o pegar un link.</p>
              </div>
              <button onClick={addGalleryImage} className="bg-secondary-container text-on-secondary-container py-2 px-4 rounded-lg text-sm font-medium shadow-sm whitespace-nowrap">
                + Agregar Imagen
              </button>
            </div>
            <div className="space-y-4">
              {(settings.galleryImages ?? []).map((img, index) => (
                <div key={index} className="border border-outline-variant rounded-xl p-4 bg-white">
                  <div className="flex justify-between items-center mb-3 gap-4">
                    <p className="text-sm font-medium text-primary">Imagen {index + 1}</p>
                    <button onClick={() => removeGalleryImage(index)} className="text-xs bg-error-container text-error px-3 py-1 rounded-lg font-medium">
                      Quitar
                    </button>
                  </div>
                  <div className="space-y-3">
                    {img.src ? (
                      <img src={img.src} alt={img.alt || `Trabajo ${index + 1}`} className="w-full h-48 object-cover rounded-xl border border-outline-variant" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-48 rounded-xl border border-dashed border-outline-variant bg-surface-container flex items-center justify-center text-sm text-on-surface-variant">
                        Sin imagen cargada
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Subir foto</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={e => void uploadGalleryImage(index, e.target.files?.[0] ?? null)}
                          className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface file:mr-3 file:border-0 file:bg-primary-container file:text-primary file:px-3 file:py-2 file:rounded-lg file:font-medium"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">O pegar link</span>
                        <input
                          type="url"
                          value={img.src}
                          onChange={e => updateGalleryImage(index, 'src', e.target.value)}
                          className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface"
                          placeholder="https://..."
                        />
                      </label>
                    </div>
                    {uploadingGalleryIndex === index && (
                      <p className="text-sm text-on-surface-variant">Subiendo imagen...</p>
                    )}
                    <input
                      type="text"
                      value={img.alt}
                      onChange={e => updateGalleryImage(index, 'alt', e.target.value)}
                      className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface"
                      placeholder="Texto alternativo (ej. Manicura)"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {settingsSaveNotice && (
            <div role="status" className="rounded-xl border border-primary-container bg-primary-container px-4 py-3 text-sm text-primary">
              {settingsSaveNotice}
            </div>
          )}
          {settingsSaveError && (
            <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
              {settingsSaveError}
            </div>
          )}
          <button
            onClick={saveSettings}
            disabled={savingSettings}
            className="bg-primary-dim text-white py-3 px-6 rounded-xl font-medium w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {savingSettings ? 'Guardando...' : 'Guardar Configuracion'}
          </button>
        </div>
      )}

      {tab === 'empleadas' && (
        <div className="space-y-6">
          <div className="bg-background border border-primary-container p-6 rounded-[16px] shadow-sm">
            <h2 className="font-serif text-[18px] mb-4 text-primary">{editingEmployeeId ? 'Editar Empleada' : 'Nueva Empleada'}</h2>
            <div className="space-y-4">
              {employeeSaveNotice && (
                <div role="status" className="rounded-xl border border-primary-container bg-primary-container px-4 py-3 text-sm text-primary">
                  {employeeSaveNotice}
                </div>
              )}
              {employeeSaveError && (
                <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
                  {employeeSaveError}
                </div>
              )}
              <input
                type="text"
                placeholder="Nombre de la empleada"
                value={employeeNameDraft}
                onChange={e => { setEmployeeNameDraft(e.target.value); setEmployeeSaveError(''); setEmployeeSaveNotice(''); }}
                className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
              />
              <div className="flex gap-3">
                <button onClick={saveEmployee} disabled={savingEmployee} className="bg-primary-dim text-white font-medium py-2 px-6 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed">
                  {savingEmployee ? 'Guardando...' : 'Guardar'}
                </button>
                {editingEmployeeId && (
                  <button onClick={resetEmployeeForm} className="bg-surface-container-highest text-on-surface font-medium py-2 px-6 rounded-xl">
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {employeeOptions.map((employee) => {
              const assignedServicesCount = services.filter((service) => getEmployeeIdWithFallback(service) === employee.id).length;
              const isDefaultEmployee = employee.id === DEFAULT_EMPLOYEE_ID;

              return (
                <div key={employee.id} className="bg-background border border-primary-container p-4 rounded-[16px] flex justify-between items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-sans font-medium text-[15px] text-primary">{employee.name}</h4>
                      {isDefaultEmployee && (
                        <span className="text-[10px] uppercase tracking-[1px] font-bold px-2 py-1 rounded bg-primary-container text-primary">Default</span>
                      )}
                    </div>
                    <span className="text-[12px] text-on-surface-variant font-light">{assignedServicesCount} servicios asignados</span>
                  </div>
                  {!isDefaultEmployee && (
                    <div className="flex gap-2">
                      <button onClick={() => beginEmployeeEdit(employee)} className="p-2 text-primary-dim hover:text-primary transition-colors bg-primary-container rounded-lg"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                      <button onClick={() => void deleteEmployee(employee)} className="p-2 text-error bg-error-container rounded-lg"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
                <label className="block">
                  <span className="block text-sm font-medium text-primary mb-2">Empleada</span>
                  <select
                    value={editingService.employeeId || DEFAULT_EMPLOYEE_ID}
                    onChange={e => {
                      const selectedEmployee = findEmployee(e.target.value) || DEFAULT_EMPLOYEE;
                      setEditingService({
                        ...editingService,
                        employeeId: selectedEmployee.id,
                        employeeName: selectedEmployee.name,
                      });
                      setServiceSaveError('');
                    }}
                    className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                  >
                    {employeeOptions.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name}</option>
                    ))}
                  </select>
                </label>
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
                  <p className="text-[12px] text-on-surface-variant font-light">Atiende: {getServiceAssignedEmployeeName(s)}</p>
                  <span className="text-[12px] text-on-surface-variant font-light">{s.durationMinutes} min • ${s.price.toLocaleString('es-AR')}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingService(toEditingService(s)); setServiceSaveError(''); }} className="p-2 text-primary-dim hover:text-primary transition-colors bg-primary-container rounded-lg"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                  <button onClick={() => deleteService(s.id)} className="p-2 text-error bg-error-container rounded-lg"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 bg-background border border-primary-container p-6 rounded-[16px] shadow-sm">
            <h3 className="font-serif text-[18px] mb-4 text-primary">Imagenes por servicio</h3>
            {serviceImageNotice && (
              <div role="status" className="mb-4 rounded-xl border border-primary-container bg-primary-container px-4 py-3 text-sm text-primary">
                {serviceImageNotice}
              </div>
            )}

            {services.length === 0 ? (
              <p className="text-on-surface-variant bg-white border border-outline-variant rounded-xl p-4 text-center">No hay servicios cargados.</p>
            ) : (
              <div className="divide-y divide-outline-variant border-y border-outline-variant">
                {services.map((service) => {
                  const draft = serviceImageDrafts[service.id] || getInitialImageDraft(service);
                  const savedImageUrl = (service.imageUrl || '').trim();
                  const previewUrl = draft.mode === 'url' ? draft.url.trim() : savedImageUrl;
                  const showPreview = previewUrl && isValidHttpUrl(previewUrl);
                  const isSaving = savingImageFor === service.id;
                  const saveLabel = draft.mode === 'upload'
                    ? (isSaving ? 'Subiendo...' : 'Subir y guardar')
                    : (isSaving ? 'Guardando...' : 'Guardar imagen');

                  return (
                    <div key={service.id} className="py-5">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start">
                        <div className="h-28 w-full md:h-24 md:w-28 shrink-0 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-highest">
                          {showPreview ? (
                            <img src={previewUrl} alt={service.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-on-surface-variant">
                              <span className="material-symbols-outlined text-[32px]">image</span>
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="font-sans text-[15px] font-medium text-primary">{service.name}</h3>
                              <p className="text-[12px] text-on-surface-variant">{service.durationMinutes} min - ${service.price.toLocaleString('es-AR')}</p>
                            </div>
                            <div className="inline-flex w-full rounded-xl border border-outline-variant bg-white p-1 sm:w-auto">
                              <button
                                type="button"
                                onClick={() => updateServiceImageDraft(service.id, { mode: 'url', file: null })}
                                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all sm:flex-none ${draft.mode === 'url' ? 'bg-primary-container text-primary' : 'text-on-surface-variant'}`}
                              >
                                Link
                              </button>
                              <button
                                type="button"
                                onClick={() => updateServiceImageDraft(service.id, { mode: 'upload' })}
                                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all sm:flex-none ${draft.mode === 'upload' ? 'bg-primary-container text-primary' : 'text-on-surface-variant'}`}
                              >
                                Subir foto
                              </button>
                            </div>
                          </div>

                          {draft.mode === 'url' ? (
                            <input
                              type="url"
                              value={draft.url}
                              onChange={e => updateServiceImageDraft(service.id, { url: e.target.value })}
                              className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface"
                              placeholder="https://..."
                            />
                          ) : (
                            <div className="space-y-2">
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={e => updateServiceImageDraft(service.id, { file: e.target.files?.[0] || null })}
                                className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface file:mr-4 file:rounded-lg file:border-0 file:bg-primary-container file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
                              />
                              {draft.file && (
                                <p className="text-xs text-on-surface-variant">{draft.file.name}</p>
                              )}
                            </div>
                          )}

                          {serviceImageErrors[service.id] && (
                            <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
                              {serviceImageErrors[service.id]}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => saveServiceImage(service)}
                            disabled={isSaving}
                            className="bg-primary-dim text-white py-3 px-6 rounded-xl font-medium w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {saveLabel}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                  <p className="text-[12px] text-on-surface-variant">Atiende: {getEmployeeNameWithFallback(appt)}</p>
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

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import ShareWeekPreview from '../components/ShareWeekPreview';
import {
  completeGoogleRedirectLogin,
  db,
  auth,
  hasPendingGoogleRedirectLogin,
  storage,
  loginWithEmail,
  loginWithGoogle,
  logout,
  handleFirestoreError,
  OperationType,
} from '../firebase';
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
import {
  BUSINESS_END_TIME,
  BUSINESS_START_TIME,
  getTimeValueMinutes,
  isBusinessDay,
  isValidTimeValue,
  normalizeShareSlotTimes,
  SHARE_SLOT_TIMES,
} from '../lib/availability';
import {
  ADMIN_EMAILS_LABEL,
  ADMIN_ACCESS_ERROR_CODE,
  ADMIN_ACCESS_ERROR_MESSAGE,
  PRIMARY_ADMIN_EMAIL,
  isAdminUser,
} from '../lib/adminAuth';
import {
  DEFAULT_GALLERY_IMAGES,
  buildSettingsPayload,
  getShareSettingsValidationMessage,
  normalizeShareBackgroundOverlayOpacity,
  normalizeStudioSettings,
} from '../lib/studioSettings';
import firebaseConfig from '../../firebase-applet-config.json';
import { addDays, addMinutes, format, isValid, parse } from 'date-fns';

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

type EditingAppointmentDraft = {
  serviceId: string;
  employeeId: string;
  clientFirstName: string;
  clientLastName: string;
  date: string;
  startTime: string;
  status: Appointment['status'];
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const APPOINTMENT_STATUS_LABELS: Record<Appointment['status'], string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

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

const toEditingAppointmentDraft = (appointment: Appointment): EditingAppointmentDraft => ({
  serviceId: appointment.serviceId,
  employeeId: getEmployeeIdWithFallback(appointment),
  clientFirstName: appointment.clientFirstName,
  clientLastName: appointment.clientLastName,
  date: appointment.date,
  startTime: appointment.startTime,
  status: appointment.status,
});

const getTodayDateKey = () => format(new Date(), 'yyyy-MM-dd');

const parseDateKey = (value: string) => parse(value, 'yyyy-MM-dd', new Date());

const isValidDateKey = (value: string) => {
  if (!value) return false;

  const parsed = parseDateKey(value);
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value;
};

const formatDateKeyLabel = (value: string) => (
  isValidDateKey(value) ? format(parseDateKey(value), 'dd/MM/yyyy') : value
);

const shiftDateKey = (value: string, amount: number) => {
  const baseDate = isValidDateKey(value) ? parseDateKey(value) : new Date();
  return format(addDays(baseDate, amount), 'yyyy-MM-dd');
};

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

const getAuthErrorCode = (error: any) => {
  if (typeof error?.code === 'string') {
    return error.code;
  }

  const message = typeof error?.message === 'string' ? error.message : '';
  const match = message.match(/auth\/[a-z-]+/i);
  return match?.[0]?.toLowerCase() || '';
};

const getAuthErrorMessage = (error: any) => {
  const errorCode = getAuthErrorCode(error);
  const errorMessage = typeof error?.message === 'string' ? error.message.toUpperCase() : '';
  const readableErrorMessage = typeof error?.message === 'string'
    ? error.message.replace(/^Firebase:\s*/i, '').replace(/\.$/, '')
    : '';

  if (errorMessage.includes('CONFIGURATION_NOT_FOUND')) {
    return "Google Sign-In no esta configurado en Firebase Authentication. Habilita el proveedor Google.";
  }

  if (!errorCode) {
    return 'No se pudo ingresar. Revisa la conexion e intenta nuevamente.';
  }

  if (errorCode === ADMIN_ACCESS_ERROR_CODE) {
    return ADMIN_ACCESS_ERROR_MESSAGE;
  }

  if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
    return 'Email o contrasena incorrectos. Revisa los datos o restablece la clave desde Firebase Authentication.';
  }

  if (errorCode === 'auth/operation-not-allowed') {
    return "Para ingresar, habilita los proveedores 'Google' y/o 'Correo electronico/Contrasena' en Firebase Authentication.";
  }

  if (errorCode === 'auth/configuration-not-found') {
    return "Google Sign-In no esta configurado en Firebase Authentication. Habilita el proveedor Google.";
  }

  if (errorCode === 'auth/too-many-requests') {
    return 'Firebase bloqueo temporalmente los intentos de ingreso. Espera unos minutos y proba de nuevo.';
  }

  if (errorCode === 'auth/user-disabled') {
    return 'Esta cuenta fue deshabilitada en Firebase Authentication.';
  }

  if (errorCode === 'auth/network-request-failed') {
    return 'Firebase no pudo conectarse. Revisa internet, VPN o bloqueadores del navegador e intenta de nuevo.';
  }

  if (errorCode === 'auth/unauthorized-domain') {
    const currentDomain = typeof window !== 'undefined' ? window.location.hostname : 'este dominio';
    return `Google no esta autorizado para ${currentDomain}. En Firebase project ${firebaseConfig.projectId}, agrega exactamente ${currentDomain} en Authentication > Settings > Authorized domains.`;
  }

  if (errorCode === 'auth/invalid-api-key') {
    return 'La configuracion de Firebase Auth es invalida. Revisa la apiKey del proyecto.';
  }

  if (errorCode === 'auth/web-storage-unsupported') {
    return 'Este navegador bloquea el almacenamiento necesario para iniciar sesion. Proba en Chrome, Safari o Edge normal.';
  }

  if (errorCode === 'auth/popup-blocked') {
    return 'El navegador bloqueo la ventana emergente de Google. Habilitala e intenta de nuevo.';
  }

  if (errorCode === 'auth/cancelled-popup-request') {
    return 'Ya hay un intento de ingreso con Google en curso.';
  }

  if (errorCode === 'auth/popup-closed-by-user') {
    return '';
  }

  if (errorCode === 'auth/operation-not-supported-in-this-environment') {
    return 'Este navegador no permite abrir Google Sign-In con ventana emergente. Se intento usar redireccion en su lugar.';
  }

  if (readableErrorMessage) {
    return `No se pudo ingresar: ${readableErrorMessage}`;
  }

  return 'No se pudo ingresar. Revisa la conexion e intenta nuevamente.';
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
  const [email, setEmail] = useState(PRIMARY_ADMIN_EMAIL);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState<'email' | 'google' | null>(null);
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
  const [selectedAppointmentsDate, setSelectedAppointmentsDate] = useState(getTodayDateKey);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);
  const [editingAppointmentDraft, setEditingAppointmentDraft] = useState<EditingAppointmentDraft | null>(null);
  const [savingAppointment, setSavingAppointment] = useState(false);
  const [appointmentSaveError, setAppointmentSaveError] = useState('');
  const isAdmin = isAdminUser(user);
  const isAuthenticating = authLoading !== null;

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((currentUser) => setUser(currentUser));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!hasPendingGoogleRedirectLogin()) {
      return;
    }

    let cancelled = false;

    const resolveGoogleRedirect = async () => {
      try {
        setAuthLoading('google');
        setAuthError('');
        await completeGoogleRedirectLogin();
      } catch (error: any) {
        if (!cancelled) {
          console.error('Google redirect login error', error);
          setAuthError(getAuthErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(null);
        }
      }
    };

    void resolveGoogleRedirect();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isAdmin) {
      setAuthError('');
    }
  }, [isAdmin]);

  useEffect(() => {
    const activeTabButton = tabBarRef.current?.querySelector<HTMLElement>(`[data-admin-tab="${tab}"]`);
    activeTabButton?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [tab]);

  useEffect(() => {
    if (!user || !isAdminUser(user)) return;

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
      } catch (error) {
        try {
          handleFirestoreError(error, OperationType.WRITE, 'employees/milagros');
        } catch {
          // Keep the panel available even if seeding the default employee fails.
        }
      }
    };

    void ensureDefaultEmployee();

    const unsubServices = onSnapshot(collection(db, 'services'), (snapshot) => {
      setServices(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Service)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'services'));

    const unsubAppointments = onSnapshot(query(collection(db, 'appointments')), (snapshot) => {
      setAppointments(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Appointment)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'appointments'));

    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
      setEmployees(withDefaultEmployee(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Employee))));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'employees'));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), snap => {
      if (!snap.exists()) return;
      const data = snap.data() as StudioSettings;
      setSettings(normalizeStudioSettings(data));
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/global'));

    return () => {
      unsubServices();
      unsubAppointments();
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
  const sortedServices = [...services].sort((a, b) => a.name.localeCompare(b.name));
  const selectedDateAppointments = appointments
    .filter((appointment) => appointment.date === selectedAppointmentsDate)
    .sort((a, b) => {
      const timeDiff = a.startTime.localeCompare(b.startTime);
      if (timeDiff !== 0) return timeDiff;
      return a.clientFirstName.localeCompare(b.clientFirstName);
    });

  const resetAppointmentEditor = () => {
    setEditingAppointmentId(null);
    setEditingAppointmentDraft(null);
    setAppointmentSaveError('');
  };

  const changeSelectedAppointmentsDate = (nextDate: string) => {
    setSelectedAppointmentsDate(nextDate);
    resetAppointmentEditor();
  };

  const findEmployee = (employeeId?: string) => (
    employeeOptions.find((employee) => employee.id === (employeeId || DEFAULT_EMPLOYEE_ID))
  );

  const resolveDraftService = (draft: EditingAppointmentDraft, sourceAppointment?: Appointment | null) => {
    const service = services.find((entry) => entry.id === draft.serviceId);
    if (service) return service;

    if (sourceAppointment && sourceAppointment.serviceId === draft.serviceId) {
      return {
        id: sourceAppointment.serviceId,
        name: sourceAppointment.serviceName,
        durationMinutes: sourceAppointment.durationMinutes,
        price: sourceAppointment.price,
        isActive: true,
        createdAt: sourceAppointment.createdAt,
        employeeId: getEmployeeIdWithFallback(sourceAppointment),
        employeeName: getEmployeeNameWithFallback(sourceAppointment),
      } as Service;
    }

    return null;
  };

  const resolveDraftEmployee = (draft: EditingAppointmentDraft, sourceAppointment?: Appointment | null) => {
    const employee = findEmployee(draft.employeeId);
    if (employee) return employee;

    if (sourceAppointment && getEmployeeIdWithFallback(sourceAppointment) === draft.employeeId) {
      return {
        id: draft.employeeId,
        name: getEmployeeNameWithFallback(sourceAppointment),
        createdAt: sourceAppointment.createdAt,
        updatedAt: sourceAppointment.createdAt,
      } as Employee;
    }

    return null;
  };

  const beginAppointmentEdit = (appointment: Appointment) => {
    setEditingAppointmentId(appointment.id);
    setEditingAppointmentDraft(toEditingAppointmentDraft(appointment));
    setAppointmentSaveError('');
  };

  const updateAppointmentDraft = (patch: Partial<EditingAppointmentDraft>) => {
    setEditingAppointmentDraft((current) => (
      current ? { ...current, ...patch } : current
    ));
    setAppointmentSaveError('');
  };

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
    } catch (error) {
      setEmployeeSaveError('No se pudo guardar la empleada. Revisa permisos o conexion e intenta de nuevo.');
      try {
        handleFirestoreError(error, OperationType.WRITE, 'employees');
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
    } catch (error) {
      setEmployeeSaveError('No se pudo eliminar la empleada. Revisa permisos o conexion e intenta de nuevo.');
      try {
        handleFirestoreError(error, OperationType.DELETE, `employees/${employee.id}`);
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
          : 'No se pudo guardar la imagen. Revisa la conexion e intenta de nuevo.',
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
      setServiceSaveError('Completa el nombre del servicio.');
      return;
    }

    if (durationMinutes === null || durationMinutes <= 0) {
      setServiceSaveError('La duracion debe ser un numero mayor a 0.');
      return;
    }

    if (price === null || price < 0) {
      setServiceSaveError('El precio debe ser un numero valido.');
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
    } catch (error) {
      setServiceSaveError('No se pudo guardar el servicio. Revisa permisos o conexion e intenta de nuevo.');
      try {
        handleFirestoreError(error, OperationType.WRITE, 'services');
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
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `services/${id}`);
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
    } catch (error: any) {
      console.error('Settings save error', error);
      const message = getSettingsSaveErrorMessage(error);
      if (saveContext === 'share') {
        setShareSettingsSaveError(message);
      } else {
        setSettingsSaveError(message);
      }
      try {
        handleFirestoreError(error, OperationType.WRITE, 'settings/global');
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
    } catch (error) {
      console.error('Gallery upload error', error);
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

  const saveAppointment = async () => {
    if (!editingAppointmentId || !editingAppointmentDraft) return;

    const sourceAppointment = appointments.find((appointment) => appointment.id === editingAppointmentId);
    if (!sourceAppointment) {
      setAppointmentSaveError('El turno ya no existe o fue actualizado en otra sesion.');
      return;
    }

    const service = resolveDraftService(editingAppointmentDraft, sourceAppointment);
    if (!service) {
      setAppointmentSaveError('Selecciona un servicio valido antes de guardar.');
      return;
    }

    const employee = resolveDraftEmployee(editingAppointmentDraft, sourceAppointment);
    if (!employee) {
      setAppointmentSaveError('Selecciona una empleada valida antes de guardar.');
      return;
    }

    const clientFirstName = editingAppointmentDraft.clientFirstName.trim();
    const clientLastName = editingAppointmentDraft.clientLastName.trim();
    const date = editingAppointmentDraft.date.trim();
    const startTime = editingAppointmentDraft.startTime.trim();

    if (!clientFirstName || !clientLastName) {
      setAppointmentSaveError('Completa nombre y apellido del cliente.');
      return;
    }

    if (!isValidDateKey(date)) {
      setAppointmentSaveError('Selecciona una fecha valida.');
      return;
    }

    if (!isValidTimeValue(startTime)) {
      setAppointmentSaveError('Selecciona una hora valida.');
      return;
    }

    const appointmentDate = parseDateKey(date);
    if (!isBusinessDay(appointmentDate)) {
      setAppointmentSaveError('Solo se permiten turnos de lunes a sabado.');
      return;
    }

    const businessStartMinutes = getTimeValueMinutes(BUSINESS_START_TIME);
    const businessEndMinutes = getTimeValueMinutes(BUSINESS_END_TIME);
    const startMinutes = getTimeValueMinutes(startTime);
    const endMinutes = startMinutes + service.durationMinutes;

    if (startMinutes < businessStartMinutes || endMinutes > businessEndMinutes) {
      setAppointmentSaveError(`El horario debe quedar dentro del rango ${BUSINESS_START_TIME} a ${BUSINESS_END_TIME}.`);
      return;
    }

    const endTime = format(
      addMinutes(parse(startTime, 'HH:mm', appointmentDate), service.durationMinutes),
      'HH:mm',
    );

    if (editingAppointmentDraft.status !== 'cancelled') {
      const overlappingAppointment = appointments.find((appointment) => {
        if (appointment.id === editingAppointmentId) return false;
        if (appointment.date !== date) return false;
        if (getEmployeeIdWithFallback(appointment) !== employee.id) return false;
        if (appointment.status !== 'pending' && appointment.status !== 'confirmed') return false;
        if (!isValidTimeValue(appointment.startTime) || !isValidTimeValue(appointment.endTime)) return false;

        const appointmentStartMinutes = getTimeValueMinutes(appointment.startTime);
        const appointmentEndMinutes = getTimeValueMinutes(appointment.endTime);
        return startMinutes < appointmentEndMinutes && appointmentStartMinutes < endMinutes;
      });

      if (overlappingAppointment) {
        setAppointmentSaveError(
          `Se superpone con el turno de ${overlappingAppointment.clientFirstName} ${overlappingAppointment.clientLastName} (${overlappingAppointment.startTime} - ${overlappingAppointment.endTime}) para ${employee.name}.`,
        );
        return;
      }
    }

    try {
      setSavingAppointment(true);
      setAppointmentSaveError('');

      await updateDoc(doc(db, 'appointments', editingAppointmentId), {
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        date,
        startTime,
        endTime,
        clientFirstName,
        clientLastName,
        status: editingAppointmentDraft.status,
        depositAmount: settings.depositAmount,
        employeeId: employee.id,
        employeeName: employee.name,
      });

      setSelectedAppointmentsDate(date);
      resetAppointmentEditor();
    } catch (error) {
      setAppointmentSaveError('No se pudo guardar el turno. Revisa permisos o conexion e intenta de nuevo.');
      try {
        handleFirestoreError(error, OperationType.UPDATE, `appointments/${editingAppointmentId}`);
      } catch {
        // Keep the appointment editor open after logging the Firestore context.
      }
    } finally {
      setSavingAppointment(false);
    }
  };

  const actAppt = async (id: string, status: Appointment['status']) => {
    const appointment = appointments.find((entry) => entry.id === id);
    if (!appointment) return;

    if (status !== 'cancelled') {
      const employeeId = getEmployeeIdWithFallback(appointment);
      const startTime = appointment.startTime;
      const endTime = appointment.endTime;

      if (!isValidTimeValue(startTime) || !isValidTimeValue(endTime)) {
        alert('El turno tiene un horario invalido. Editalo antes de cambiar el estado.');
        return;
      }

      const startMinutes = getTimeValueMinutes(startTime);
      const endMinutes = getTimeValueMinutes(endTime);
      const overlappingAppointment = appointments.find((entry) => {
        if (entry.id === id) return false;
        if (entry.date !== appointment.date) return false;
        if (getEmployeeIdWithFallback(entry) !== employeeId) return false;
        if (entry.status !== 'pending' && entry.status !== 'confirmed') return false;
        if (!isValidTimeValue(entry.startTime) || !isValidTimeValue(entry.endTime)) return false;

        const entryStartMinutes = getTimeValueMinutes(entry.startTime);
        const entryEndMinutes = getTimeValueMinutes(entry.endTime);
        return startMinutes < entryEndMinutes && entryStartMinutes < endMinutes;
      });

      if (overlappingAppointment) {
        alert(
          `No se puede cambiar el estado porque se superpone con ${overlappingAppointment.clientFirstName} ${overlappingAppointment.clientLastName} (${overlappingAppointment.startTime} - ${overlappingAppointment.endTime}).`,
        );
        return;
      }
    }
    try {
      await updateDoc(doc(db, 'appointments', id), { status });
      if (editingAppointmentId === id) {
        setEditingAppointmentDraft((current) => (
          current ? { ...current, status } : current
        ));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `appointments/${id}`);
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

    for (const baseService of baseServices) {
      await addDoc(collection(db, 'services'), {
        ...baseService,
        employeeId: DEFAULT_EMPLOYEE_ID,
        employeeName: DEFAULT_EMPLOYEE_NAME,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
    }

    alert('Servicios base cargados');
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;

    try {
      setAuthLoading('email');
      setAuthError('');
      await loginWithEmail(normalizedEmail, password);
    } catch (error: any) {
      console.error('Login error', error);
      setAuthError(getAuthErrorMessage(error));
    } finally {
      setAuthLoading(null);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setAuthLoading('google');
      setAuthError('');
      await loginWithGoogle();
    } catch (error: any) {
      console.error('Google login error', error);
      const nextError = getAuthErrorMessage(error);
      if (nextError) {
        setAuthError(nextError);
      }
    } finally {
      setAuthLoading(null);
    }
  };

  const goToAdjacentTab = (direction: -1 | 1) => {
    const currentIndex = ADMIN_TABS.findIndex((adminTab) => adminTab.id === tab);
    const nextIndex = (currentIndex + direction + ADMIN_TABS.length) % ADMIN_TABS.length;
    setTab(ADMIN_TABS[nextIndex].id);
  };

  const selectedAppointmentsDateLabel = formatDateKeyLabel(selectedAppointmentsDate);

  if (user && !isAdmin) {
    return (
      <Layout>
        <div className="text-center py-10 bg-background border border-error-container rounded-[20px] shadow-sm max-w-md mx-auto space-y-4 px-6">
          <h1 className="text-[24px] font-serif text-primary">Acceso restringido</h1>
          <p className="text-sm text-on-surface-variant">
            La cuenta <span className="font-medium text-on-surface">{user.email || 'actual'}</span> no tiene permisos de administracion.
          </p>
          <p className="text-sm text-on-surface-variant">
            Ingresa con una cuenta administradora: <span className="font-medium text-on-surface">{ADMIN_EMAILS_LABEL}</span>.
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="bg-primary-dim text-white py-3 px-6 rounded-xl font-medium shadow-sm hover:opacity-90 transition-all"
          >
            Salir
          </button>
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="text-center py-10 bg-background border border-primary-container rounded-[20px] shadow-sm max-w-sm mx-auto">
          <h1 className="text-[24px] font-serif text-primary mb-6">Acceso a Gestor</h1>
          {authError && (
            <div role="alert" className="mx-6 mb-4 rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
              {authError}
            </div>
          )}
          <div className="px-6 mb-4">
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              disabled={isAuthenticating}
              className="w-full rounded-xl border border-outline-variant bg-white px-4 py-3 font-medium text-on-surface shadow-sm transition-all hover:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authLoading === 'google' ? 'Ingresando con Google...' : 'Ingresar con Google'}
            </button>
          </div>
          <div className="px-6 mb-4 text-xs uppercase tracking-[2px] text-on-surface-variant">o con email y contrasena</div>
          <form onSubmit={handleLogin} className="flex flex-col gap-4 px-6 mb-4">
            <input type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setAuthError(''); }} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Tu Email" required />
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setAuthError(''); }} className="bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface" placeholder="Contrasena" required />
            <button type="submit" disabled={isAuthenticating} className="bg-primary-dim text-white py-3 rounded-xl font-medium shadow-sm hover:opacity-90 transition-all mt-2 disabled:cursor-not-allowed disabled:opacity-60">
              {authLoading === 'email' ? 'Ingresando...' : 'Ingresar a la cuenta'}
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
          <button onClick={() => void logout()} className="text-sm text-on-surface-variant font-medium underline">Salir</button>
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
                          onChange={(e) => void uploadGalleryImage(index, e.target.files?.[0] ?? null)}
                          className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface file:mr-3 file:border-0 file:bg-primary-container file:text-primary file:px-3 file:py-2 file:rounded-lg file:font-medium"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">O pegar link</span>
                        <input
                          type="url"
                          value={img.src}
                          onChange={(e) => updateGalleryImage(index, 'src', e.target.value)}
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
                      onChange={(e) => updateGalleryImage(index, 'alt', e.target.value)}
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
                onChange={(e) => { setEmployeeNameDraft(e.target.value); setEmployeeSaveError(''); setEmployeeSaveNotice(''); }}
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
                <input type="text" placeholder="Nombre (ej. Esmaltado)" value={editingService.name || ''} onChange={(e) => { setEditingService({ ...editingService, name: e.target.value }); setServiceSaveError(''); }} className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3" />
                <label className="block">
                  <span className="block text-sm font-medium text-primary mb-2">Empleada</span>
                  <select
                    value={editingService.employeeId || DEFAULT_EMPLOYEE_ID}
                    onChange={(e) => {
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
                  <input type="text" inputMode="numeric" placeholder="Minutos (ej. 35)" value={editingService.durationMinutes || ''} onChange={(e) => { setEditingService({ ...editingService, durationMinutes: e.target.value }); setServiceSaveError(''); }} className="w-1/2 bg-white border border-outline-variant rounded-xl px-4 py-3" />
                  <input type="text" inputMode="decimal" placeholder="Precio ($)" value={editingService.price || ''} onChange={(e) => { setEditingService({ ...editingService, price: e.target.value }); setServiceSaveError(''); }} className="w-1/2 bg-white border border-outline-variant rounded-xl px-4 py-3" />
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={editingService.isActive} onChange={(e) => setEditingService({ ...editingService, isActive: e.target.checked })} className="rounded text-primary focus:ring-primary" />
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
            {services.map((service) => (
              <div key={service.id} className="bg-background border border-primary-container p-4 rounded-[16px] flex justify-between items-center">
                <div>
                  <h4 className="font-sans font-medium text-[15px] text-primary mb-1">{service.name}</h4>
                  <p className="text-[12px] text-on-surface-variant font-light">Atiende: {getServiceAssignedEmployeeName(service)}</p>
                  <span className="text-[12px] text-on-surface-variant font-light">{service.durationMinutes} min - ${service.price.toLocaleString('es-AR')}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingService(toEditingService(service)); setServiceSaveError(''); }} className="p-2 text-primary-dim hover:text-primary transition-colors bg-primary-container rounded-lg"><span className="material-symbols-outlined text-[18px]">edit</span></button>
                  <button onClick={() => void deleteService(service.id)} className="p-2 text-error bg-error-container rounded-lg"><span className="material-symbols-outlined text-[18px]">delete</span></button>
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
                              onChange={(e) => updateServiceImageDraft(service.id, { url: e.target.value })}
                              className="w-full bg-white border border-outline-variant focus:border-primary focus:ring-0 rounded-xl px-4 py-3 text-on-surface"
                              placeholder="https://..."
                            />
                          ) : (
                            <div className="space-y-2">
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => updateServiceImageDraft(service.id, { file: e.target.files?.[0] || null })}
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
                            onClick={() => void saveServiceImage(service)}
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
          <div className="bg-background border border-primary-container p-5 rounded-[16px] shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="font-serif text-[20px] text-primary">Turnos del dia</h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  {selectedDateAppointments.length} turno{selectedDateAppointments.length === 1 ? '' : 's'} para el {selectedAppointmentsDateLabel}.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="inline-flex items-center rounded-xl border border-outline-variant bg-white p-1">
                  <button
                    type="button"
                    onClick={() => changeSelectedAppointmentsDate(shiftDateKey(selectedAppointmentsDate, -1))}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-highest"
                  >
                    <span className="material-symbols-outlined text-[18px] align-middle">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => changeSelectedAppointmentsDate(getTodayDateKey())}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary-container"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => changeSelectedAppointmentsDate(shiftDateKey(selectedAppointmentsDate, 1))}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-highest"
                  >
                    <span className="material-symbols-outlined text-[18px] align-middle">chevron_right</span>
                  </button>
                </div>
                <label className="block">
                  <span className="block text-sm font-medium text-primary mb-2">Fecha</span>
                  <input
                    type="date"
                    value={selectedAppointmentsDate}
                    onChange={(e) => changeSelectedAppointmentsDate(e.target.value || getTodayDateKey())}
                    className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                  />
                </label>
              </div>
            </div>
          </div>

          {selectedDateAppointments.map((appointment) => {
            const isEditing = editingAppointmentId === appointment.id && editingAppointmentDraft !== null;
            const draft = isEditing ? editingAppointmentDraft : null;
            const draftService = draft ? resolveDraftService(draft, appointment) : null;
            const draftEmployee = draft ? resolveDraftEmployee(draft, appointment) : null;
            const selectedServiceMissing = Boolean(draft && draftService && !services.some((service) => service.id === draft.serviceId));
            const selectedEmployeeMissing = Boolean(draft && draftEmployee && !employeeOptions.some((employee) => employee.id === draft.employeeId));
            const draftEndTime = draft && draftService && isValidDateKey(draft.date) && isValidTimeValue(draft.startTime)
              ? format(addMinutes(parse(draft.startTime, 'HH:mm', parseDateKey(draft.date)), draftService.durationMinutes), 'HH:mm')
              : null;

            return (
              <div key={appointment.id} className={`p-4 rounded-[16px] border ${appointment.status === 'pending' ? 'bg-background border-outline-variant shadow-sm' : appointment.status === 'confirmed' ? 'bg-primary-container border-primary-dim' : 'bg-surface-container-highest border-transparent opacity-80'}`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-serif text-[18px] tracking-tight text-primary">{appointment.clientFirstName} {appointment.clientLastName}</p>
                    <p className="text-[13px] text-on-surface-variant font-medium">{appointment.serviceName}</p>
                    <p className="text-[12px] text-on-surface-variant">Atiende: {getEmployeeNameWithFallback(appointment)}</p>
                  </div>
                  <div className="md:text-right">
                    <p className="font-bold text-[14px] text-primary">{formatDateKeyLabel(appointment.date)}</p>
                    <p className="text-[12px] text-on-surface-variant font-medium">{appointment.startTime} - {appointment.endTime}</p>
                    <p className="text-[12px] text-on-surface-variant">Senia actual: ${appointment.depositAmount.toLocaleString('es-AR')}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 mt-4 lg:flex-row lg:items-center lg:justify-between">
                  <span className="text-[10px] uppercase tracking-[2px] font-bold px-2 py-1 rounded bg-white text-primary w-fit">
                    {APPOINTMENT_STATUS_LABELS[appointment.status]}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(['pending', 'confirmed', 'cancelled'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => void actAppt(appointment.id, status)}
                        disabled={appointment.status === status}
                        className={`text-xs font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${appointment.status === status ? 'bg-white text-on-surface border border-outline-variant' : status === 'confirmed' ? 'bg-primary-dim text-white hover:opacity-90' : status === 'cancelled' ? 'bg-white text-on-surface border border-outline-variant hover:bg-surface-container-highest' : 'bg-secondary-container text-on-secondary-container hover:opacity-90'}`}
                      >
                        {APPOINTMENT_STATUS_LABELS[status]}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => (isEditing ? resetAppointmentEditor() : beginAppointmentEdit(appointment))}
                      className="text-xs bg-primary-container text-primary font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
                    >
                      {isEditing ? 'Cerrar' : 'Editar'}
                    </button>
                  </div>
                </div>

                {isEditing && draft && (
                  <div className="mt-4 border-t border-outline-variant pt-4 space-y-4">
                    {appointmentSaveError && (
                      <div role="alert" className="rounded-xl border border-error-container bg-error-container px-4 py-3 text-sm text-error">
                        {appointmentSaveError}
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Nombre</span>
                        <input
                          type="text"
                          value={draft.clientFirstName}
                          onChange={(e) => updateAppointmentDraft({ clientFirstName: e.target.value })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Apellido</span>
                        <input
                          type="text"
                          value={draft.clientLastName}
                          onChange={(e) => updateAppointmentDraft({ clientLastName: e.target.value })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="block text-sm font-medium text-primary mb-2">Servicio</span>
                        <select
                          value={draft.serviceId}
                          onChange={(e) => updateAppointmentDraft({ serviceId: e.target.value })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        >
                          {selectedServiceMissing && draftService && (
                            <option value={draft.serviceId}>{draftService.name} (fuera del catalogo)</option>
                          )}
                          {sortedServices.map((service) => (
                            <option key={service.id} value={service.id}>{service.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Empleada</span>
                        <select
                          value={draft.employeeId}
                          onChange={(e) => updateAppointmentDraft({ employeeId: e.target.value })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        >
                          {selectedEmployeeMissing && draftEmployee && (
                            <option value={draft.employeeId}>{draftEmployee.name} (sin ficha activa)</option>
                          )}
                          {employeeOptions.map((employee) => (
                            <option key={employee.id} value={employee.id}>{employee.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Estado</span>
                        <select
                          value={draft.status}
                          onChange={(e) => updateAppointmentDraft({ status: e.target.value as Appointment['status'] })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        >
                          {(['pending', 'confirmed', 'cancelled'] as const).map((status) => (
                            <option key={status} value={status}>{APPOINTMENT_STATUS_LABELS[status]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Fecha</span>
                        <input
                          type="date"
                          value={draft.date}
                          onChange={(e) => updateAppointmentDraft({ date: e.target.value })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-medium text-primary mb-2">Hora de inicio</span>
                        <input
                          type="time"
                          step={1800}
                          value={draft.startTime}
                          onChange={(e) => updateAppointmentDraft({ startTime: e.target.value })}
                          className="w-full bg-white border border-outline-variant rounded-xl px-4 py-3"
                        />
                      </label>
                    </div>

                    {draftService && draftEndTime && (
                      <div className="rounded-xl border border-outline-variant bg-white px-4 py-3 text-sm text-on-surface-variant">
                        Finaliza a las <span className="font-medium text-on-surface">{draftEndTime}</span> - {draftService.durationMinutes} min - ${draftService.price.toLocaleString('es-AR')}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void saveAppointment()}
                        disabled={savingAppointment}
                        className="bg-primary-dim text-white font-medium py-2 px-6 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {savingAppointment ? 'Guardando...' : 'Guardar cambios'}
                      </button>
                      <button
                        type="button"
                        onClick={resetAppointmentEditor}
                        className="bg-surface-container-highest text-on-surface font-medium py-2 px-6 rounded-xl"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {selectedDateAppointments.length === 0 && (
            <p className="text-on-surface-variant bg-white border border-outline-variant rounded-xl p-4 text-center">
              No hay turnos registrados para el {selectedAppointmentsDateLabel}.
            </p>
          )}
        </div>
      )}
    </Layout>
  );
}

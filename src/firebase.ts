import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import type { Appointment } from './types';
import { ADMIN_ACCESS_ERROR_CODE, ADMIN_ACCESS_ERROR_MESSAGE, isAdminEmail, normalizeEmail } from './lib/adminAuth';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

const APPOINTMENTS_COLLECTION = 'appointments';
const GOOGLE_REDIRECT_PENDING_KEY = 'mini-milagros-admin-google-redirect';

type PendingAppointmentPayload = Omit<Appointment, 'id'> & {
  status: 'pending';
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const toFirestoreValue = (value: unknown): Record<string, unknown> => {
  if (value === null) {
    return { nullValue: null };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => toFirestoreValue(entry)),
      },
    };
  }

  switch (typeof value) {
    case 'string':
      return { stringValue: value };
    case 'number':
      return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    case 'boolean':
      return { booleanValue: value };
    case 'object':
      return {
        mapValue: {
          fields: Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, toFirestoreValue(entry)]),
          ),
        },
      };
    default:
      throw new Error(`Unsupported Firestore value type: ${typeof value}`);
  }
};

const buildPublicAppointmentDocumentId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `appt-${crypto.randomUUID().replace(/-/g, '')}`;
  }

  return `appt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const savePendingAppointmentWithRest = async (appointment: PendingAppointmentPayload) => {
  const documentId = buildPublicAppointmentDocumentId();
  const endpoint = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${APPOINTMENTS_COLLECTION}/${documentId}?key=${firebaseConfig.apiKey}`;
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(appointment).map(([key, value]) => [key, toFirestoreValue(value)]),
      ),
    }),
    keepalive: true,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`firestore-rest-error:${response.status}:${errorText}`);
  }

  return {
    id: documentId,
    payload: await response.json(),
  };
};

export const savePublicPendingAppointment = async (
  appointment: PendingAppointmentPayload,
  timeoutMs = 8000,
) => {
  const result = await withTimeout(
    savePendingAppointmentWithRest(appointment),
    timeoutMs,
    'firestore-rest-timeout',
  );

  return { method: 'rest' as const, id: result.id };
};

const buildAdminAccessError = () => {
  const error = new Error(ADMIN_ACCESS_ERROR_MESSAGE) as Error & { code: string };
  error.code = ADMIN_ACCESS_ERROR_CODE;
  return error;
};

const setGoogleRedirectPending = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, '1');
};

const clearGoogleRedirectPending = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
};

export const hasPendingGoogleRedirectLogin = () => {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY) === '1';
};

const shouldPreferGoogleRedirect = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  const isMobileDevice = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(userAgent);
  const isInAppBrowser = /(FBAN|FBAV|Instagram|Line|TikTok|; wv\)|WebView)/i.test(userAgent);
  const isStandaloneApp = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;

  return isMobileDevice || isInAppBrowser || isStandaloneApp;
};

const shouldFallbackGooglePopupToRedirect = (error: any) => (
  error?.code === 'auth/popup-blocked' ||
  error?.code === 'auth/operation-not-supported-in-this-environment'
);

const startGoogleRedirectLogin = async (provider: GoogleAuthProvider) => {
  setGoogleRedirectPending();
  await signInWithRedirect(auth, provider);
  return { redirected: true as const };
};

const ensureAdminAccess = async <T extends { user: { email: string | null } }>(result: T) => {
  if (isAdminEmail(result.user.email)) {
    return result;
  }

  await signOut(auth);
  throw buildAdminAccessError();
};

export const loginWithEmail = async (email: string, pass: string) => {
  const result = await signInWithEmailAndPassword(auth, normalizeEmail(email), pass);
  return await ensureAdminAccess(result);
};

export const registerWithEmail = async (email: string, pass: string) => {
  return await createUserWithEmailAndPassword(auth, normalizeEmail(email), pass);
};

export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  if (shouldPreferGoogleRedirect()) {
    return await startGoogleRedirectLogin(provider);
  }

  try {
    const result = await signInWithPopup(auth, provider);
    await ensureAdminAccess(result);
    return { redirected: false as const };
  } catch (error) {
    if (shouldFallbackGooglePopupToRedirect(error)) {
      return await startGoogleRedirectLogin(provider);
    }

    console.error("Login err", error);
    throw error;
  }
};

export const completeGoogleRedirectLogin = async () => {
  if (!hasPendingGoogleRedirectLogin()) {
    return false;
  }

  try {
    const result = await getRedirectResult(auth);
    if (!result) {
      return false;
    }

    await ensureAdminAccess(result);
    return true;
  } finally {
    clearGoogleRedirectPending();
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout err", error);
    throw error;
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

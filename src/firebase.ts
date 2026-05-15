import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, doc, getFirestore, setDoc } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import type { Appointment } from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

const APPOINTMENTS_COLLECTION = 'appointments';

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

const savePendingAppointmentWithRest = async (
  appointment: PendingAppointmentPayload,
  documentId: string,
) => {
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

  return response.json();
};

export const savePublicPendingAppointment = async (
  appointment: PendingAppointmentPayload,
  timeoutMs = 8000,
) => {
  const appointmentRef = doc(collection(db, APPOINTMENTS_COLLECTION));
  const appointmentId = appointmentRef.id;

  try {
    await withTimeout(
      setDoc(appointmentRef, appointment),
      timeoutMs,
      'firestore-sdk-timeout',
    );
    return { method: 'sdk' as const, id: appointmentId };
  } catch (sdkError) {
    console.warn('Falling back to Firestore REST appointment save', sdkError);
    await withTimeout(
      savePendingAppointmentWithRest(appointment, appointmentId),
      timeoutMs,
      'firestore-rest-timeout',
    );
    return { method: 'rest' as const, id: appointmentId };
  }
};

export const loginWithEmail = async (email: string, pass: string) => {
  try {
    return await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), pass);
  } catch (error: any) {
    if (
      error?.code === 'auth/invalid-credential' ||
      error?.code === 'auth/user-not-found' ||
      error?.code === 'auth/wrong-password'
    ) {
      alert('Email o contrasena incorrectos. Revisa los datos o restablece la clave desde Firebase Authentication.');
      return undefined;
    }

    throw error;
  }
};

export const registerWithEmail = async (email: string, pass: string) => {
  return await createUserWithEmailAndPassword(auth, email, pass);
};

export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login err", error);
    throw error;
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

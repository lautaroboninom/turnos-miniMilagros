import type { User } from 'firebase/auth';

export const ADMIN_EMAILS = ['milagrosisas34@gmail.com', 'lautaroboninom@gmail.com'] as const;
export const PRIMARY_ADMIN_EMAIL = ADMIN_EMAILS[0];
export const ADMIN_ACCESS_ERROR_CODE = 'auth/admin-email-not-authorized';
export const ADMIN_EMAILS_LABEL = ADMIN_EMAILS.join(' o ');
export const ADMIN_ACCESS_ERROR_MESSAGE = `Solo las cuentas administradoras autorizadas (${ADMIN_EMAILS_LABEL}) pueden acceder al panel de administracion.`;

const ADMIN_EMAIL_SET = new Set<string>(ADMIN_EMAILS);

export const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';

export const isAdminEmail = (value: string | null | undefined) => ADMIN_EMAIL_SET.has(normalizeEmail(value));

export const isAdminUser = (user: Pick<User, 'email'> | null | undefined) => isAdminEmail(user?.email);

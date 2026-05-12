import { addDays, addMinutes, format, getDay, isBefore, parse } from 'date-fns';
import type { Appointment } from '../types';

export const BUSINESS_START_TIME = '08:00';
export const BUSINESS_END_TIME = '19:00';
export const SLOT_INTERVAL_MINUTES = 30;
export const SHARE_SLOT_TIMES = ['08:00', '10:00', '13:00', '15:00', '17:00', '18:00'] as const;

export type ShareSlotStatus = 'free' | 'unavailable';

export type AvailabilityAppointment = Pick<Appointment, 'startTime' | 'endTime' | 'status'> & {
  date?: string;
};

export interface ShareSlot {
  time: string;
  status: ShareSlotStatus;
}

export interface ShareDayAvailability {
  date: Date;
  dateKey: string;
  slots: ShareSlot[];
}

const BLOCKING_STATUSES: Appointment['status'][] = ['pending', 'confirmed'];

export const getDateKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const isBusinessDay = (date: Date) => getDay(date) !== 0;

export const isBlockingAppointment = (appointment: AvailabilityAppointment) => (
  BLOCKING_STATUSES.includes(appointment.status)
);

const parseTimeForDate = (date: Date, time: string) => parse(time, 'HH:mm', date);

const isSameDateAppointment = (date: Date, appointment: AvailabilityAppointment) => (
  !appointment.date || appointment.date === getDateKey(date)
);

const slotFitsBeforeClose = (date: Date, startTime: string, durationMinutes: number) => {
  const start = parseTimeForDate(date, startTime);
  const end = addMinutes(start, durationMinutes);
  const close = parseTimeForDate(date, BUSINESS_END_TIME);

  return isBefore(end, addMinutes(close, 1));
};

const slotOverlapsAppointment = (
  date: Date,
  startTime: string,
  durationMinutes: number,
  appointment: AvailabilityAppointment,
) => {
  const slotStart = parseTimeForDate(date, startTime);
  const slotEnd = addMinutes(slotStart, durationMinutes);
  const appointmentStart = parseTimeForDate(date, appointment.startTime);
  const appointmentEnd = parseTimeForDate(date, appointment.endTime);

  return isBefore(slotStart, appointmentEnd) && isBefore(appointmentStart, slotEnd);
};

const isPastSlot = (date: Date, startTime: string, now = new Date()) => (
  isBefore(parseTimeForDate(date, startTime), now)
);

export const getSlotStatus = (
  date: Date,
  startTime: string,
  durationMinutes: number,
  appointments: AvailabilityAppointment[],
): ShareSlotStatus => {
  if (!isBusinessDay(date) || !slotFitsBeforeClose(date, startTime, durationMinutes)) {
    return 'unavailable';
  }

  if (isPastSlot(date, startTime)) {
    return 'unavailable';
  }

  const hasOverlap = appointments.some((appointment) => (
    isSameDateAppointment(date, appointment) &&
    isBlockingAppointment(appointment) &&
    slotOverlapsAppointment(date, startTime, durationMinutes, appointment)
  ));

  return hasOverlap ? 'unavailable' : 'free';
};

export const getCandidateSlotTimesForDate = (date: Date, durationMinutes: number) => {
  const slots: string[] = [];
  let current = parseTimeForDate(date, BUSINESS_START_TIME);
  const close = parseTimeForDate(date, BUSINESS_END_TIME);

  while (isBefore(current, close)) {
    const time = format(current, 'HH:mm');
    if (slotFitsBeforeClose(date, time, durationMinutes)) {
      slots.push(time);
    }
    current = addMinutes(current, SLOT_INTERVAL_MINUTES);
  }

  return slots;
};

export const getAvailableSlotsForDate = (
  date: Date,
  durationMinutes: number,
  appointments: AvailabilityAppointment[],
) => (
  getCandidateSlotTimesForDate(date, durationMinutes)
    .filter((time) => getSlotStatus(date, time, durationMinutes, appointments) === 'free')
);

export const getShareSlotsForDate = (
  date: Date,
  durationMinutes: number,
  appointments: AvailabilityAppointment[],
): ShareSlot[] => (
  SHARE_SLOT_TIMES
    .filter((time) => slotFitsBeforeClose(date, time, durationMinutes))
    .map((time) => ({
      time,
      status: getSlotStatus(date, time, durationMinutes, appointments),
    }))
);

export const buildShareWeekAvailability = (
  weekStart: Date,
  durationMinutes: number,
  appointments: AvailabilityAppointment[],
): ShareDayAvailability[] => (
  Array.from({ length: 6 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      date,
      dateKey: getDateKey(date),
      slots: getShareSlotsForDate(date, durationMinutes, appointments),
    };
  })
);

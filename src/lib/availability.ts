import { addDays, addMinutes, format, getDay, isBefore, parse } from 'date-fns';
import type { Appointment } from '../types';

export const BUSINESS_START_TIME = '08:00';
export const BUSINESS_END_TIME = '19:00';
export const SLOT_INTERVAL_MINUTES = 30;
export const SHARE_SLOT_TIMES = ['08:00', '10:00', '13:00', '15:00', '17:00', '18:00'] as const;
export const SHARE_SLOT_DURATION_MINUTES = 30;
export const MAX_SHARE_SLOT_TIMES = 8;

export type ShareSlotStatus = 'free' | 'booked' | 'past' | 'closed';

export interface AvailabilityWindow {
  startTime: string;
  endTime: string;
}

export const DEFAULT_AVAILABILITY_WINDOW: AvailabilityWindow = {
  startTime: BUSINESS_START_TIME,
  endTime: BUSINESS_END_TIME,
};

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

export const isValidTimeValue = (time: unknown): time is string => (
  typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
);

export const getTimeValueMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const normalizeShareSlotTimes = (slotTimes: unknown): string[] => {
  const source = Array.isArray(slotTimes) ? slotTimes : SHARE_SLOT_TIMES;
  const uniqueTimes = new Set<string>();

  source.forEach((time) => {
    if (isValidTimeValue(time)) {
      uniqueTimes.add(time);
    }
  });

  const normalizedTimes = Array.from(uniqueTimes)
    .sort((a, b) => getTimeValueMinutes(a) - getTimeValueMinutes(b))
    .slice(0, MAX_SHARE_SLOT_TIMES);

  return normalizedTimes.length > 0 ? normalizedTimes : [...SHARE_SLOT_TIMES];
};

const isSameDateAppointment = (date: Date, appointment: AvailabilityAppointment) => (
  !appointment.date || appointment.date === getDateKey(date)
);

export const slotFitsWithinAvailabilityWindow = (
  startTime: string,
  durationMinutes: number,
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
) => {
  if (
    !isValidTimeValue(startTime) ||
    !isValidTimeValue(availabilityWindow.startTime) ||
    !isValidTimeValue(availabilityWindow.endTime)
  ) {
    return false;
  }

  const slotStartMinutes = getTimeValueMinutes(startTime);
  const slotEndMinutes = slotStartMinutes + durationMinutes;

  return (
    slotStartMinutes >= getTimeValueMinutes(availabilityWindow.startTime) &&
    slotEndMinutes <= getTimeValueMinutes(availabilityWindow.endTime)
  );
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
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
): ShareSlotStatus => {
  if (!isBusinessDay(date) || !slotFitsWithinAvailabilityWindow(startTime, durationMinutes, availabilityWindow)) {
    return 'closed';
  }

  if (isPastSlot(date, startTime)) {
    return 'past';
  }

  const hasOverlap = appointments.some((appointment) => (
    isSameDateAppointment(date, appointment) &&
    isBlockingAppointment(appointment) &&
    slotOverlapsAppointment(date, startTime, durationMinutes, appointment)
  ));

  return hasOverlap ? 'booked' : 'free';
};

export const getCandidateSlotTimesForDate = (date: Date, durationMinutes: number) => {
  const slots: string[] = [];
  let current = parseTimeForDate(date, DEFAULT_AVAILABILITY_WINDOW.startTime);
  const close = parseTimeForDate(date, DEFAULT_AVAILABILITY_WINDOW.endTime);

  while (isBefore(current, close)) {
    const time = format(current, 'HH:mm');
    if (slotFitsWithinAvailabilityWindow(time, durationMinutes)) {
      slots.push(time);
    }
    current = addMinutes(current, SLOT_INTERVAL_MINUTES);
  }

  return slots;
};

export const getCandidateSlotTimesForDateWithinWindow = (
  date: Date,
  durationMinutes: number,
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
) => {
  const slots: string[] = [];
  let current = parseTimeForDate(date, availabilityWindow.startTime);
  const close = parseTimeForDate(date, availabilityWindow.endTime);

  while (isBefore(current, close)) {
    const time = format(current, 'HH:mm');
    if (slotFitsWithinAvailabilityWindow(time, durationMinutes, availabilityWindow)) {
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
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
) => (
  getCandidateSlotTimesForDateWithinWindow(date, durationMinutes, availabilityWindow)
    .filter((time) => getSlotStatus(date, time, durationMinutes, appointments, availabilityWindow) === 'free')
);

export const getShareSlotsForDate = (
  date: Date,
  durationMinutes: number,
  appointments: AvailabilityAppointment[],
  slotTimes: unknown = SHARE_SLOT_TIMES,
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
): ShareSlot[] => (
  normalizeShareSlotTimes(slotTimes)
    .map((time) => ({
      time,
      status: getSlotStatus(date, time, durationMinutes, appointments, availabilityWindow),
    }))
);

export const buildShareWeekAvailability = (
  weekStart: Date,
  durationMinutes: number,
  appointments: AvailabilityAppointment[],
  slotTimes: unknown = SHARE_SLOT_TIMES,
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
): ShareDayAvailability[] => (
  Array.from({ length: 6 }, (_, index) => {
    const date = addDays(weekStart, index);
    return {
      date,
      dateKey: getDateKey(date),
      slots: getShareSlotsForDate(date, durationMinutes, appointments, slotTimes, availabilityWindow),
    };
  })
);

export const getInvalidShareSlotTimes = (
  slotTimes: unknown,
  durationMinutes: number,
  availabilityWindow: AvailabilityWindow = DEFAULT_AVAILABILITY_WINDOW,
) => (
  normalizeShareSlotTimes(slotTimes)
    .filter((time) => !slotFitsWithinAvailabilityWindow(time, durationMinutes, availabilityWindow))
);

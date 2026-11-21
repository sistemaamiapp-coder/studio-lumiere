import { BUSINESS } from './config.js';
import { toMinutes, toTime, weekday, nowMinutes, toISO } from './utils.js';

export function workingHours(date) {
  return BUSINESS.hours[weekday(date)] || null;
}

export function fitsHours(date, time, duration) {
  const hours = workingHours(date);
  if (!hours) return false;
  const start = toMinutes(time);
  return start >= toMinutes(hours[0]) && start + duration <= toMinutes(hours[1]);
}

export function slotsFor(date, service, appointments) {
  const hours = workingHours(date);
  if (!hours) return [];
  const open = toMinutes(hours[0]);
  const close = toMinutes(hours[1]);
  const step = BUSINESS.slotMinutes;
  const duration = Number(service.duration_min);
  const today = toISO();
  const earliest = date === today ? nowMinutes() + BUSINESS.minLeadMinutes : -1;
  const slots = [];

  for (let start = open; start + duration <= close; start += step) {
    if (date === today && start < earliest) continue;
    const end = start + duration;
    const hasConflict = appointments.some(appt => {
      if (appt.status === 'cancelado' || appt.status === 'faltou') return false;
      const busyStart = toMinutes(appt.time);
      const busyEnd = busyStart + Number(appt.duration_min);
      return start < busyEnd && end > busyStart;
    });
    if (!hasConflict) slots.push(toTime(start));
  }
  return slots;
}

export function hasConflict(date, time, duration, appointments, ignoreId = null) {
  const start = toMinutes(time);
  const end = start + Number(duration);
  return appointments.some(appt => {
    if (appt.status === 'cancelado' || appt.status === 'faltou') return false;
    if (ignoreId && Number(appt.id) === Number(ignoreId)) return false;
    const busyStart = toMinutes(appt.time);
    const busyEnd = busyStart + Number(appt.duration_min);
    return start < busyEnd && end > busyStart;
  });
}

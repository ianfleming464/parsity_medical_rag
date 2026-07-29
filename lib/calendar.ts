/**
 * Cal.com Integration
 *
 * Provides appointment scheduling via Cal.com API.
 * This is the "action" part of the human-in-the-loop pattern.
 *
 * Setup:
 * 1. Create account at https://cal.com
 * 2. Create an event type (e.g., "Patient Appointment")
 * 3. Get API key from Settings -> Developer -> API Keys
 * 4. Get event type ID from the URL when editing the event type
 * 5. Add to .env: CAL_API_KEY and CAL_EVENT_TYPE_ID
 */

const CAL_API_BASE = 'https://api.cal.com/v2';
const CAL_API_VERSION = '2024-08-13';

export interface ScheduleRequest {
  patientName: string;
  dateTime: string; // ISO 8601 format
  timeZone: string;
}

export interface ScheduleResult {
  success: boolean;
  bookingId?: string;
  bookingUrl?: string;
  error?: string;
}

/**
 * Check if Cal.com is configured
 */
export function isCalConfigured(): boolean {
  return Boolean(
    process.env.CAL_API_KEY &&
      process.env.CAL_EVENT_TYPE_ID &&
      process.env.CAL_ATTENDEE_EMAIL,
  );
}

/**
 * Schedule an appointment via Cal.com API
 *
 * The app keeps Cal.com credentials on the server. The attendee email is a
 * developer-owned test inbox because the synthetic Patient schema has no email.
 */
export async function scheduleAppointment(
  request: ScheduleRequest
): Promise<ScheduleResult> {
  if (!isCalConfigured()) {
    return {
      success: false,
      error:
        'Cal.com is not configured. Set CAL_API_KEY, CAL_EVENT_TYPE_ID, and CAL_ATTENDEE_EMAIL.',
    };
  }

  const eventTypeId = Number.parseInt(process.env.CAL_EVENT_TYPE_ID!, 10);
  if (!Number.isInteger(eventTypeId) || eventTypeId <= 0) {
    return {
      success: false,
      error: 'CAL_EVENT_TYPE_ID must be a positive numeric event type ID.',
    };
  }

  try {
    const response = await fetch(`${CAL_API_BASE}/bookings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CAL_API_KEY}`,
        'Content-Type': 'application/json',
        'cal-api-version': CAL_API_VERSION,
      },
      body: JSON.stringify({
        start: request.dateTime,
        attendee: {
          name: request.patientName,
          email: process.env.CAL_ATTENDEE_EMAIL,
          timeZone: request.timeZone,
        },
        eventTypeId,
        metadata: { source: 'medical-rag-demo' },
      }),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload
          ? String(payload.message)
          : `Cal.com booking failed (${response.status}).`;
      return { success: false, error: message };
    }

    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? payload.data
        : null;
    const booking = data && typeof data === 'object' ? data : null;

    return {
      success: true,
      bookingId:
        booking && 'uid' in booking
          ? String(booking.uid)
          : booking && 'id' in booking
            ? String(booking.id)
            : undefined,
      bookingUrl:
        booking && 'bookingUrl' in booking ? String(booking.bookingUrl) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `Could not reach Cal.com: ${error.message}`
          : 'Could not reach Cal.com.',
    };
  }
}

/**
 * Cancel an appointment
 *
 * TODO (Extension): Implement appointment cancellation
 */
export async function cancelAppointment(bookingId: string): Promise<ScheduleResult> {
  // TODO: Implement cancellation via Cal.com API
  return {
    success: false,
    error: 'Not implemented',
  };
}

/**
 * Reschedule an appointment
 *
 * TODO (Extension): Implement appointment rescheduling
 */
export async function rescheduleAppointment(
  bookingId: string,
  newDateTime: string
): Promise<ScheduleResult> {
  // TODO: Implement rescheduling via Cal.com API
  return {
    success: false,
    error: 'Not implemented',
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { scheduleAppointment } from './calendar';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function configureCal() {
  vi.stubEnv('CAL_API_KEY', 'cal_test_key');
  vi.stubEnv('CAL_EVENT_TYPE_ID', '123');
  vi.stubEnv('CAL_ATTENDEE_EMAIL', 'developer@example.com');
}

describe('scheduleAppointment', () => {
  it('creates a v2 Cal.com booking with a server-side API key', async () => {
    configureCal();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'success', data: { uid: 'booking_uid_123' } }),
        { status: 201 },
      ),
    );
    global.fetch = fetchMock;

    const result = await scheduleAppointment({
      patientName: 'Abe Frami',
      dateTime: '2026-07-10T14:00:00.000Z',
      timeZone: 'Europe/Berlin',
    });

    expect(result).toEqual({
      success: true,
      bookingId: 'booking_uid_123',
      bookingUrl: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cal.com/v2/bookings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer cal_test_key',
          'cal-api-version': '2024-08-13',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      start: '2026-07-10T14:00:00.000Z',
      attendee: {
        name: 'Abe Frami',
        email: 'developer@example.com',
        timeZone: 'Europe/Berlin',
      },
      eventTypeId: 123,
      metadata: { source: 'medical-rag-demo' },
    });
  });

  it('returns Cal.com errors without throwing', async () => {
    configureCal();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Selected time is unavailable.' }), { status: 422 }),
    );

    await expect(
      scheduleAppointment({
        patientName: 'Abe Frami',
        dateTime: '2026-07-10T14:00:00.000Z',
        timeZone: 'Europe/Berlin',
      }),
    ).resolves.toEqual({ success: false, error: 'Selected time is unavailable.' });
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('./openai', () => ({
	openai: { responses: { parse: vi.fn() } },
}));

import {
	buildSchedulingAction,
	buildSchedulingMessage,
	type SchedulingIntent,
} from './scheduling';

describe('scheduling presentation', () => {
	it('returns a deterministic confirmation-card message instead of generated UI text', () => {
		const intent: SchedulingIntent = {
			isSchedulingRequest: true,
			patientName: 'Arnoldo Rath',
			suggestedDate: '2026-08-03',
			suggestedTime: '10:00',
			reason: null,
		};

		const action = buildSchedulingAction(intent);

		expect(action).not.toBeNull();
		expect(buildSchedulingMessage(action!)).toBe(
			'Ready to schedule an appointment for Arnoldo Rath. Please review the proposed date and time in the confirmation card, then select Confirm Appointment to book it.',
		);
	});

	it('does not create a confirmation action without both intent and patient name', () => {
		expect(
			buildSchedulingAction({
				isSchedulingRequest: false,
				patientName: 'Arnoldo Rath',
				suggestedDate: null,
				suggestedTime: null,
				reason: null,
			}),
		).toBeNull();
	});
});

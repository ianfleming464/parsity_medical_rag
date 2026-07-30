import { describe, expect, it } from 'vitest';

import { buildPatientMetadataFilter } from './patient-filter';

describe('buildPatientMetadataFilter', () => {
	it('builds no filter when no patient constraint is supplied', () => {
		expect(buildPatientMetadataFilter()).toBeUndefined();
	});

	it('builds an inclusion filter for hybrid patient IDs', () => {
		expect(buildPatientMetadataFilter(['patient-1', 'patient-2'])).toEqual({
			patientId: { $in: ['patient-1', 'patient-2'] },
		});
	});

	it('builds an exclusion filter for an explicit different-patient request', () => {
		expect(buildPatientMetadataFilter(undefined, ['patient-1'])).toEqual({
			patientId: { $nin: ['patient-1'] },
		});
	});

	it('combines hybrid inclusion and explicit exclusion', () => {
		expect(
			buildPatientMetadataFilter(['patient-1', 'patient-2'], ['patient-1']),
		).toEqual({
			$and: [
				{ patientId: { $in: ['patient-1', 'patient-2'] } },
				{ patientId: { $nin: ['patient-1'] } },
			],
		});
	});
});

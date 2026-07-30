export type PatientMetadataFilter =
	| { patientId: string | { $in: string[] } | { $nin: string[] } }
	| { $and: PatientMetadataFilter[] };

function uniquePatientIds(patientIds: string[] | undefined): string[] {
	return [...new Set((patientIds ?? []).filter(Boolean))];
}

/**
 * Builds the Pinecone metadata constraint for patient-scoped note retrieval.
 * An include list narrows a hybrid search to SQL-matched patients; an exclude
 * list is used only for explicit requests for a different patient.
 */
export function buildPatientMetadataFilter(
	patientIds?: string[],
	excludePatientIds?: string[],
): PatientMetadataFilter | undefined {
	const included = uniquePatientIds(patientIds);
	const excluded = uniquePatientIds(excludePatientIds);
	const filters: PatientMetadataFilter[] = [];

	if (included.length === 1) {
		filters.push({ patientId: included[0] });
	} else if (included.length > 1) {
		filters.push({ patientId: { $in: included } });
	}

	if (excluded.length > 0) {
		filters.push({ patientId: { $nin: excluded } });
	}

	if (filters.length === 0) return undefined;
	if (filters.length === 1) return filters[0];

	return { $and: filters };
}

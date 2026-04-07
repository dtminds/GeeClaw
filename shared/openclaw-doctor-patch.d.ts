export const OPENCLAW_DOCTOR_PATCH_TARGET_NAME_RE: RegExp;
export const OPENCLAW_DOCTOR_PATCH_SENTINEL: string;

export function patchOpenClawDoctorBundledRuntimeDepsSource(source: string): {
  changed: boolean;
  matched: boolean;
  source: string;
};

export function findOpenClawDoctorPatchRelativePath(
  candidateNames: string[],
  readText: (candidateName: string) => string,
): string | null;

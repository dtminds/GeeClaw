export const OPENCLAW_DOCTOR_PATCH_TARGET_NAME_RE = /^prompt-select-styled(?:-[^.]+)?\.js$/;
export const OPENCLAW_DOCTOR_PATCH_SENTINEL = 'bundledPluginsDisabledRaw === "1" || bundledPluginsDisabledRaw === "true"';

const DOCTOR_PATCH_TARGET_RE =
  /(async function maybeRepairBundledPluginRuntimeDeps\(params\)\s*\{\r?\n)([ \t]*)const packageRoot = params\.packageRoot \?\? resolveOpenClawPackageRootSync\(\{/m;

export function patchOpenClawDoctorBundledRuntimeDepsSource(source) {
  if (source.includes(OPENCLAW_DOCTOR_PATCH_SENTINEL)) {
    return { changed: false, matched: true, source };
  }

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const nextSource = source.replace(
    DOCTOR_PATCH_TARGET_RE,
    (_match, prefix, indent) => (
      `${prefix}`
      + `${indent}const bundledPluginsDisabledRaw = (params.env ?? process.env).OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim().toLowerCase();${newline}`
      + `${indent}if (bundledPluginsDisabledRaw === "1" || bundledPluginsDisabledRaw === "true") return;${newline}`
      + `${indent}const packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({`
    ),
  );

  if (nextSource === source) {
    return { changed: false, matched: false, source };
  }

  return { changed: true, matched: true, source: nextSource };
}

export function findOpenClawDoctorPatchRelativePath(candidateNames, readText) {
  const prioritized = candidateNames.filter((name) => OPENCLAW_DOCTOR_PATCH_TARGET_NAME_RE.test(name));
  const fallbacks = candidateNames.filter((name) => name.endsWith('.js') && !OPENCLAW_DOCTOR_PATCH_TARGET_NAME_RE.test(name));

  for (const candidateName of [...prioritized, ...fallbacks]) {
    const source = readText(candidateName);
    if (patchOpenClawDoctorBundledRuntimeDepsSource(source).matched) {
      return candidateName;
    }
  }

  return null;
}

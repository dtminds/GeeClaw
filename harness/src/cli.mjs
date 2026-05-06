#!/usr/bin/env node
import process from 'node:process';
import { getChangedFiles } from './git.mjs';
import { PROFILES, selectSteps } from './profiles.mjs';
import { writeReport } from './report.mjs';
import { runStep } from './runner.mjs';
import {
  isGatewayBackendCommunicationTask,
  loadRuleSpecs,
  loadScenarioSpecs,
  loadSpec,
  toArray,
} from './specs.mjs';
import {
  scanBackendCommunicationBoundary,
  touchesCommunicationPath,
  validateGatewayTaskSpec,
} from './rules.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  pnpm harness list',
    '  pnpm harness validate --spec <path> [--since origin/main] [--no-diff]',
    '  pnpm harness explain --spec <path> [--since origin/main]',
    '  pnpm harness run --spec <path> [--since origin/main] [--dry-run] [--continue-on-error]',
  ].join('\n'));
}

async function findScenario(id) {
  const scenarios = await loadScenarioSpecs();
  return scenarios.find((scenario) => scenario.data.id === id);
}

async function list() {
  const scenarios = await loadScenarioSpecs();
  const rules = await loadRuleSpecs();
  console.log('Profiles:');
  for (const profile of Object.keys(PROFILES)) console.log(`- ${profile}`);
  console.log('\nScenario specs:');
  for (const spec of scenarios) console.log(`- ${spec.data.id}: ${spec.path}`);
  console.log('\nRule specs:');
  for (const spec of rules) console.log(`- ${spec.data.id}: ${spec.path}`);
}

async function collectChangedFiles(options) {
  const result = await getChangedFiles(options.since ?? 'origin/main');
  return {
    changedFiles: result.files,
    diffErrors: result.errors,
  };
}

async function validate(specPath, options = {}) {
  const spec = await loadSpec(specPath);
  const scenario = spec.data.scenario ? await findScenario(spec.data.scenario) : null;
  const shouldCheckDiff = !options.noDiff && (options.checkDiff || Boolean(spec.data.scenario));
  const { changedFiles, diffErrors } = shouldCheckDiff
    ? await collectChangedFiles(options)
    : { changedFiles: [], diffErrors: [] };
  const failures = [...diffErrors];

  if (spec.data.type === 'runtime-bridge' && spec.data.id === 'gateway-backend-communication') {
    for (const profile of ['fast', 'boundary']) {
      if (!toArray(spec.data.requiredProfiles).includes(profile)) {
        failures.push(`${spec.path}: requiredProfiles must include "${profile}"`);
      }
    }
    for (const rule of ['renderer-main-boundary', 'backend-communication-boundary', 'docs-sync']) {
      if (!toArray(spec.data.requiredRules).includes(rule)) {
        failures.push(`${spec.path}: requiredRules must include "${rule}"`);
      }
    }
  } else if (isGatewayBackendCommunicationTask(spec)) {
    failures.push(...validateGatewayTaskSpec(spec, scenario, changedFiles));
  } else if (!spec.data.id || !spec.data.title) {
    failures.push(`${spec.path}: spec must include id and title`);
  }

  if (changedFiles.length > 0 && touchesCommunicationPath(changedFiles) && isGatewayBackendCommunicationTask(spec)) {
    const requiredProfiles = toArray(spec.data.requiredProfiles);
    if (!requiredProfiles.includes('boundary')) {
      failures.push(`${spec.path}: communication path changes must require boundary`);
    }
  }

  return { spec, scenario, changedFiles, failures };
}

async function explain(specPath, options = {}) {
  const result = await validate(specPath, { ...options, checkDiff: Boolean(options.since) });
  const requiredProfiles = toArray(result.spec.data.requiredProfiles);
  const scenarioProfiles = toArray(result.scenario?.data?.requiredProfiles);
  const profiles = [...new Set([...scenarioProfiles, ...requiredProfiles])];
  console.log(`Spec: ${result.spec.path}`);
  console.log(`Scenario: ${result.spec.data.scenario ?? result.spec.data.id}`);
  console.log(`Task type: ${result.spec.data.taskType ?? result.spec.data.type ?? 'n/a'}`);
  console.log(`Required profiles: ${profiles.join(', ') || 'none'}`);
  if (result.changedFiles.length > 0) {
    console.log('\nChanged files:');
    for (const file of result.changedFiles) console.log(`- ${file}`);
  }
  console.log('\nSelected steps:');
  for (const step of selectSteps(profiles)) {
    console.log(`- [${step.profile}] ${step.command} ${step.args.join(' ')}`);
  }
  if (result.failures.length > 0) {
    console.log('\nValidation failures:');
    for (const failure of result.failures) console.log(`- ${failure}`);
  }
  return result.failures.length === 0 ? 0 : 1;
}

async function run(specPath, options = {}) {
  const startedAt = new Date().toISOString();
  const validation = await validate(specPath, { ...options, checkDiff: true, noDiff: Boolean(options.noDiff) });
  const profiles = [...new Set([
    ...toArray(validation.scenario?.data?.requiredProfiles),
    ...toArray(validation.spec.data.requiredProfiles),
  ])];
  const steps = [];
  const failures = [...validation.failures];

  const scanFiles = [
    ...validation.changedFiles,
    ...toArray(validation.spec.data.touchedAreas),
  ];
  const scanStart = performance.now();
  const boundaryFailures = await scanBackendCommunicationBoundary(scanFiles);
  const scanDuration = Math.ceil(performance.now() - scanStart);
  failures.push(...boundaryFailures);
  steps.push({
    profile: 'rules',
    name: 'Backend communication boundary scan',
    status: boundaryFailures.length === 0 ? 'pass' : 'fail',
    exitCode: boundaryFailures.length === 0 ? 0 : 1,
    durationMs: scanDuration,
  });

  const selectedSteps = selectSteps(profiles);
  if (failures.length === 0) {
    for (const step of selectedSteps) {
      if (options.dryRun) {
        steps.push({ ...step, status: 'skipped', exitCode: 0, durationMs: 0 });
        continue;
      }
      const result = await runStep(step);
      steps.push(result);
      if (result.exitCode !== 0) {
        failures.push(`${step.name} failed with exit code ${result.exitCode}`);
        if (!options.continueOnError) break;
      }
    }
  }

  const report = {
    specPath: validation.spec.path,
    scenario: validation.spec.data.scenario ?? validation.spec.data.id,
    result: failures.length === 0 ? 'pass' : 'fail',
    startedAt,
    finishedAt: new Date().toISOString(),
    changedFiles: validation.changedFiles,
    steps,
    failures,
  };
  const paths = await writeReport(report);
  console.log(`Harness report written to ${paths.markdownPath}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
  }
  return failures.length === 0 ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    printUsage();
    return command ? 0 : 1;
  }

  if (command === 'list') {
    await list();
    return 0;
  }

  const specPath = args.spec;
  if (!specPath) {
    printUsage();
    return 1;
  }

  if (command === 'validate') {
    const result = await validate(specPath, { since: args.since, noDiff: Boolean(args['no-diff']) });
    for (const failure of result.failures) console.error(`- ${failure}`);
    return result.failures.length === 0 ? 0 : 1;
  }

  if (command === 'explain') {
    return await explain(specPath, { since: args.since });
  }

  if (command === 'run') {
    return await run(specPath, {
      since: args.since,
      noDiff: Boolean(args['no-diff']),
      dryRun: Boolean(args['dry-run']),
      continueOnError: Boolean(args['continue-on-error']),
    });
  }

  printUsage();
  return 1;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

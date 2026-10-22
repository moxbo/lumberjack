import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

/** @typedef {{ id: number, head_sha: string, repository: string | null, event: string, status: string, conclusion: string | null, html_url: string }} WorkflowRun */
/** @typedef {{ id: number, name: string, head_sha: string, status: string, conclusion: string | null }} WorkflowJob */
/** @typedef {(path: string, collection: "workflow_runs" | "jobs", signal: AbortSignal) => Promise<unknown>} Request */
/** @typedef {{ repository: string, sha: string, signal?: AbortSignal, request?: Request, pause?: (ms: number, signal: AbortSignal) => Promise<void>, now?: () => number, log?: (message: string) => void }} CheckOptions */

export const DISCOVERY_TIMEOUT_MS = 30_000;
export const WAIT_TIMEOUT_MS = 40 * 60_000;
const POLL_INTERVAL_MS = 10_000;
const execFileAsync = promisify(execFile);

export const REQUIRED_WORKFLOWS = {
  ci: {
    file: "ci.yml",
    jobs: [
      "Lint & Format",
      "Unit Tests (ubuntu-latest)",
      "Unit Tests (windows-latest)",
      "Unit Tests (macos-latest)",
      "Build (smoke)",
    ],
  },
  integration: {
    file: "integration.yml",
    jobs: ["Container Integration Tests"],
  },
};

/** @type {Request} */
async function requestGitHub(path, collection, signal) {
  const fields =
    collection === "workflow_runs"
      ? "{id,head_sha,event,status,conclusion,html_url,repository:.head_repository.full_name}"
      : "{id,name,head_sha,status,conclusion}";
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      "--paginate",
      path,
      "--jq",
      `[.${collection}[] | ${fields}] | @json`,
    ],
    { signal, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
  );
  return stdout
    .trim()
    .split("\n")
    .flatMap((page) => JSON.parse(page));
}

/**
 * @param {unknown} value
 * @returns {value is WorkflowRun[]}
 */
function isWorkflowRuns(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (run) =>
        run !== null &&
        typeof run === "object" &&
        Number.isSafeInteger(run.id) &&
        run.id > 0 &&
        typeof run.head_sha === "string" &&
        (run.repository === null || typeof run.repository === "string") &&
        typeof run.event === "string" &&
        typeof run.status === "string" &&
        (run.conclusion === null || typeof run.conclusion === "string") &&
        typeof run.html_url === "string",
    )
  );
}

/**
 * @param {unknown} value
 * @returns {value is WorkflowJob[]}
 */
function isWorkflowJobs(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (job) =>
        job !== null &&
        typeof job === "object" &&
        Number.isSafeInteger(job.id) &&
        job.id > 0 &&
        typeof job.name === "string" &&
        typeof job.head_sha === "string" &&
        typeof job.status === "string" &&
        (job.conclusion === null || typeof job.conclusion === "string"),
    )
  );
}

/**
 * @param {"ci" | "integration"} key
 * @param {CheckOptions} options
 */
export async function waitForWorkflow(key, options) {
  const {
    repository,
    sha,
    signal = new AbortController().signal,
    request = requestGitHub,
    pause = (ms, abortSignal) =>
      setTimeout(ms, undefined, { signal: abortSignal }),
    now = Date.now,
    log = console.log,
  } = options;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("A repository and exact release commit SHA are required");
  }
  const workflow = REQUIRED_WORKFLOWS[key];
  const started = now();
  let discovered = false;
  while (true) {
    signal.throwIfAborted();
    const runs = await request(
      `repos/${repository}/actions/workflows/${workflow.file}/runs?head_sha=${sha}&exclude_pull_requests=true&per_page=100`,
      "workflow_runs",
      signal,
    );
    if (!isWorkflowRuns(runs)) {
      throw new Error(`Invalid workflow run response for ${workflow.file}`);
    }
    /** @type {WorkflowRun | undefined} */
    let latest;
    for (const run of runs) {
      // PR head SHAs need not identify the merge commit actually tested.
      if (
        run.head_sha === sha &&
        run.repository === repository &&
        (run.event === "push" || run.event === "workflow_dispatch") &&
        (!latest || run.id > latest.id)
      ) {
        latest = run;
      }
    }
    if (latest) {
      discovered = true;
      log(`${workflow.file}: ${latest.status} ${latest.html_url}`);
      if (latest.status === "completed") {
        if (latest.conclusion !== "success") {
          throw new Error(
            `${workflow.file} ${latest.conclusion ?? "has no conclusion"}: ${latest.html_url}`,
          );
        }
        const jobs = await request(
          `repos/${repository}/actions/runs/${latest.id}/jobs?filter=all&per_page=100`,
          "jobs",
          signal,
        );
        if (!isWorkflowJobs(jobs)) {
          throw new Error(`Invalid workflow job response for ${workflow.file}`);
        }
        for (const name of workflow.jobs) {
          const job = jobs
            .filter((candidate) => candidate.name === name)
            .sort((a, b) => b.id - a.id)[0];
          if (
            !job ||
            job.head_sha !== sha ||
            job.status !== "completed" ||
            job.conclusion !== "success"
          ) {
            throw new Error(
              `${workflow.file}: required job "${name}" did not succeed for ${sha}: ${latest.html_url}`,
            );
          }
        }
        log(`${workflow.file}: reusing successful checks for ${sha}`);
        return true;
      }
      if (
        !["queued", "in_progress", "waiting", "pending", "requested"].includes(
          latest.status,
        )
      ) {
        throw new Error(
          `${workflow.file}: unexpected run status "${latest.status}"`,
        );
      }
    } else if (discovered) {
      throw new Error(
        `${workflow.file}: previously discovered run disappeared`,
      );
    } else if (now() - started >= DISCOVERY_TIMEOUT_MS) {
      log(`${workflow.file}: no matching run; fresh checks are required`);
      return false;
    }
    if (now() - started >= WAIT_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${workflow.file} for ${sha}`);
    }
    await pause(POLL_INTERVAL_MS, signal);
  }
}

/** @param {Omit<CheckOptions, "signal">} options */
export async function resolveReleaseChecks(options) {
  const controller = new AbortController();
  try {
    const [ci, integration] = await Promise.all([
      waitForWorkflow("ci", { ...options, signal: controller.signal }),
      waitForWorkflow("integration", { ...options, signal: controller.signal }),
    ]);
    return { ci_reused: ci, integration_reused: integration };
  } finally {
    controller.abort();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    const sha = process.env.RELEASE_SHA;
    const output = process.env.GITHUB_OUTPUT;
    if (!repository || !sha || !output) {
      throw new Error(
        "GITHUB_REPOSITORY, RELEASE_SHA, and GITHUB_OUTPUT are required",
      );
    }
    const checks = await resolveReleaseChecks({ repository, sha });
    await appendFile(
      output,
      `ci_reused=${checks.ci_reused}\nintegration_reused=${checks.integration_reused}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

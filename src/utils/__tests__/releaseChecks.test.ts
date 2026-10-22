import { describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_TIMEOUT_MS,
  REQUIRED_WORKFLOWS,
  WAIT_TIMEOUT_MS,
  resolveReleaseChecks,
  waitForWorkflow,
} from "../../../scripts/release-checks.mjs";
import type {
  CheckOptions,
  WorkflowJob,
  WorkflowRun,
} from "../../../scripts/release-checks.mjs";

const repository = "moxbo/lumberjack";
const sha = "a".repeat(40);

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 100,
    repository,
    head_sha: sha,
    event: "push",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/moxbo/lumberjack/actions/runs/100",
    ...overrides,
  };
}

function jobs(key: keyof typeof REQUIRED_WORKFLOWS = "ci"): WorkflowJob[] {
  return REQUIRED_WORKFLOWS[key].jobs.map((name, index) => ({
    id: index + 1,
    name,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  }));
}

function harness(
  responses: unknown[] = [[run()]],
  jobResponse: unknown = jobs(),
) {
  let clock = 0;
  const request = vi
    .fn<NonNullable<CheckOptions["request"]>>()
    .mockImplementation((_path, collection) => {
      if (collection === "jobs") return Promise.resolve(jobResponse);
      const value = responses.length > 1 ? responses.shift() : responses[0];
      return Promise.resolve(value);
    });
  const pause = vi
    .fn<NonNullable<CheckOptions["pause"]>>()
    .mockImplementation((ms, signal) => {
      signal.throwIfAborted();
      clock += ms;
      return Promise.resolve();
    });
  const options: CheckOptions = {
    repository,
    sha,
    request,
    pause,
    now: () => clock,
    log: vi.fn(),
  };
  return { options, request, pause, elapsed: () => clock };
}

describe("release check reuse", () => {
  it.each(["ci", "integration"] as const)(
    "reuses %s only after verifying all required jobs",
    async (key) => {
      const { options, request, pause } = harness([[run()]], jobs(key));
      await expect(waitForWorkflow(key, options)).resolves.toBe(true);
      expect(request).toHaveBeenNthCalledWith(
        1,
        `repos/${repository}/actions/workflows/${REQUIRED_WORKFLOWS[key].file}/runs?head_sha=${sha}&exclude_pull_requests=true&per_page=100`,
        "workflow_runs",
        expect.any(AbortSignal),
      );
      expect(request).toHaveBeenNthCalledWith(
        2,
        `repos/${repository}/actions/runs/100/jobs?filter=all&per_page=100`,
        "jobs",
        expect.any(AbortSignal),
      );
      expect(pause).not.toHaveBeenCalled();
    },
  );

  it("accepts exact-commit manual runs", async () => {
    const { options } = harness([[run({ event: "workflow_dispatch" })]]);
    await expect(waitForWorkflow("ci", options)).resolves.toBe(true);
  });

  it("waits for queued and running checks instead of requesting fresh ones", async () => {
    const { options, pause } = harness([
      [run({ status: "queued", conclusion: null })],
      [run({ status: "in_progress", conclusion: null })],
      [run()],
    ]);
    await expect(waitForWorkflow("ci", options)).resolves.toBe(true);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("allows discovery time for simultaneous branch and tag pushes", async () => {
    const { options, pause } = harness([[], [], [run()]]);
    await expect(waitForWorkflow("ci", options)).resolves.toBe(true);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("requests fresh checks only after the discovery window expires", async () => {
    const { options, elapsed } = harness([[]]);
    await expect(waitForWorkflow("ci", options)).resolves.toBe(false);
    expect(elapsed()).toBe(DISCOVERY_TIMEOUT_MS);
  });

  it.each([
    { head_sha: "b".repeat(40) },
    { repository: "another/repository" },
    { repository: null },
    { event: "pull_request" },
    { event: "pull_request_target" },
    { event: "workflow_run" },
  ])("does not reuse an unrelated run: %j", async (overrides) => {
    const { options } = harness([[run(overrides)]]);
    await expect(waitForWorkflow("ci", options)).resolves.toBe(false);
  });

  it.each([
    "failure",
    "cancelled",
    "skipped",
    "timed_out",
    "action_required",
    "neutral",
    "stale",
    "startup_failure",
  ])("blocks a completed %s run", async (conclusion) => {
    const { options, request } = harness([[run({ conclusion })]]);
    await expect(waitForWorkflow("ci", options)).rejects.toThrow(conclusion);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never selects an older success over the newest failed run", async () => {
    const { options } = harness([
      [run({ id: 101, conclusion: "failure" }), run()],
    ]);
    await expect(waitForWorkflow("ci", options)).rejects.toThrow("failure");
  });

  it("waits for the latest pending run even if an older run succeeded", async () => {
    const { options, request, pause } = harness([
      [run(), run({ id: 101, status: "waiting", conclusion: null })],
      [run({ id: 101 }), run()],
    ]);
    await expect(waitForWorkflow("ci", options)).resolves.toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(request).toHaveBeenLastCalledWith(
      `repos/${repository}/actions/runs/101/jobs?filter=all&per_page=100`,
      "jobs",
      expect.any(AbortSignal),
    );
  });

  it("blocks a successful workflow whose required job is missing", async () => {
    const { options } = harness([[run()]], jobs().slice(1));
    await expect(waitForWorkflow("ci", options)).rejects.toThrow(
      'required job "Lint & Format"',
    );
  });

  it.each([
    { status: "in_progress", conclusion: null },
    { conclusion: "skipped" },
    { conclusion: "failure" },
    { head_sha: "b".repeat(40) },
  ])("blocks an invalid required job: %j", async (override) => {
    const { options } = harness(
      [[run()]],
      jobs().map((job, index) => (index === 0 ? { ...job, ...override } : job)),
    );
    await expect(waitForWorkflow("ci", options)).rejects.toThrow(
      "did not succeed",
    );
  });

  it("checks the latest attempt of each required job", async () => {
    const { options } = harness(
      [[run()]],
      [
        ...jobs(),
        {
          id: 1000,
          name: "Lint & Format",
          head_sha: sha,
          status: "completed",
          conclusion: "failure",
        },
      ],
    );
    await expect(waitForWorkflow("ci", options)).rejects.toThrow(
      'required job "Lint & Format"',
    );
  });

  it("does not turn API errors into missing checks", async () => {
    const { options, request } = harness();
    request.mockRejectedValue(new Error("HTTP 403"));
    await expect(waitForWorkflow("ci", options)).rejects.toThrow("HTTP 403");
  });

  it.each([null, {}, [{}]])(
    "rejects malformed run metadata: %j",
    async (value) => {
      const { options } = harness([value]);
      await expect(waitForWorkflow("ci", options)).rejects.toThrow(
        "Invalid workflow run response",
      );
    },
  );

  it("rejects malformed job metadata", async () => {
    const { options } = harness([[run()]], [{}]);
    await expect(waitForWorkflow("ci", options)).rejects.toThrow(
      "Invalid workflow job response",
    );
  });

  it("blocks an unexpectedly removed run", async () => {
    const { options } = harness([
      [run({ status: "in_progress", conclusion: null })],
      [],
    ]);
    await expect(waitForWorkflow("ci", options)).rejects.toThrow("disappeared");
  });

  it("bounds waiting for an existing run", async () => {
    const { options, elapsed } = harness([
      [run({ status: "queued", conclusion: null })],
    ]);
    await expect(waitForWorkflow("ci", options)).rejects.toThrow("Timed out");
    expect(elapsed()).toBe(WAIT_TIMEOUT_MS);
  });

  it.each([{ repository: "" }, { sha: "main" }])(
    "rejects non-exact release targets: %j",
    async (override) => {
      const { options, request } = harness();
      await expect(
        waitForWorkflow("ci", { ...options, ...override }),
      ).rejects.toThrow("exact release commit SHA");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("returns independent reuse decisions for mixed existing and missing checks", async () => {
    const { options, request } = harness([[]]);
    request.mockImplementation((path, collection) =>
      Promise.resolve(
        collection === "jobs"
          ? jobs()
          : path.includes("/ci.yml/")
            ? [run()]
            : [],
      ),
    );
    await expect(resolveReleaseChecks(options)).resolves.toEqual({
      ci_reused: true,
      integration_reused: false,
    });
  });

  it("aborts sibling polling as soon as one required workflow fails", async () => {
    const signals: AbortSignal[] = [];
    const request = vi
      .fn<NonNullable<CheckOptions["request"]>>()
      .mockImplementation((path, _collection, signal) => {
        signals.push(signal);
        return Promise.resolve([
          path.includes("/ci.yml/")
            ? run({ conclusion: "failure" })
            : run({ status: "in_progress", conclusion: null }),
        ]);
      });
    await expect(
      resolveReleaseChecks({ repository, sha, request, log: vi.fn() }),
    ).rejects.toThrow("failure");
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

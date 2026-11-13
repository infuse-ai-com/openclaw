import type { RunInference } from "../../agents/run-inference.js";
import { prepareCronRunInference } from "../../cron/run-inference.js";
import type { CronWorkspaceLease } from "../../cron/run-workspace.js";
import { prepareReplyTurnExecution } from "./agent-runner-admission.js";
import { resolveRunAfterAutoFallbackPrimaryProbeRecheck } from "./agent-runner-auto-fallback.js";
import type { AgentTurnParams } from "./agent-runner-execution.types.js";
import { preparePersonalRunInference } from "./agent-runner-inference.js";
import { resolveQueuedReplyRuntimeConfig } from "./agent-runner-utils.js";
import { attachProgressNarratorToReplyOptions } from "./progress-narrator.js";

type PreparedReplyTurnExecution = ReturnType<typeof prepareReplyTurnExecution>;

export async function withPreparedAgentTurnInference<T>(params: {
  executionParams: AgentTurnParams;
  execution: PreparedReplyTurnExecution;
  run: (turnParams: AgentTurnParams, inference: RunInference | undefined) => Promise<T>;
}): Promise<T> {
  const { execution, executionParams } = params;
  let runInference: RunInference | undefined;
  let workspaceLease: CronWorkspaceLease | undefined;
  try {
    execution.preparedRunAdmission.assertSourceCurrent();
    // Queue admission already froze its selection. Resolve an ordinary turn's
    // probe once, before capturing the inference account owner.
    const run =
      executionParams.replyOperation?.turnKind === "queued_followup"
        ? executionParams.followupRun.run
        : resolveRunAfterAutoFallbackPrimaryProbeRecheck({
            run: executionParams.followupRun.run,
            entry:
              executionParams.activeSessionStore?.[executionParams.sessionKey ?? ""] ??
              executionParams.getActiveSessionEntry(),
            sessionKey: executionParams.sessionKey,
          });
    executionParams.followupRun.run = run;
    if (run.scheduledAutomation) {
      const { prepareCronSessionWorktree } = await import("../../cron/run-workspace.js");
      execution.preparedRunAdmission.assertSourceCurrent();
      const workspace = await prepareCronSessionWorktree({
        sessionKey: executionParams.sessionKey ?? run.sessionKey ?? run.sessionId,
        entry: executionParams.getActiveSessionEntry(),
        workspaceDir: run.workspaceDir,
        cwd: run.cwd,
        assertCurrent: () => {
          execution.deferredLifecycle.signal?.throwIfAborted();
          execution.preparedRunAdmission.assertSourceCurrent();
        },
      });
      workspaceLease = workspace.lease;
      run.workspaceDir = workspace.workspaceDir;
      run.cwd = workspace.cwd;
    }
    const binding = run.scheduledAutomation?.job.inferenceBinding;
    if (binding) {
      runInference = await prepareCronRunInference({
        binding,
        cfg: resolveQueuedReplyRuntimeConfig(run.config),
        agentDir: run.agentDir,
      });
    } else if (!run.scheduledAutomation) {
      runInference = await preparePersonalRunInference({
        authProfileId: run.authProfileId,
        provider: run.provider,
        model: run.model,
        agentId: run.agentId,
        agentDir: run.agentDir,
        cfg: resolveQueuedReplyRuntimeConfig(run.config),
        assertCurrent: () => {
          execution.deferredLifecycle.signal?.throwIfAborted();
          execution.preparedRunAdmission.assertSourceCurrent();
        },
      });
    }
    execution.preparedRunAdmission.assertSourceCurrent();
    return await params.run(
      {
        ...executionParams,
        opts: attachProgressNarratorToReplyOptions({
          cfg: resolveQueuedReplyRuntimeConfig(run.config),
          agentId: run.agentId,
          authProfileId: binding?.profileId ?? run.authProfileId,
          getSessionEntry: () =>
            executionParams.activeSessionStore?.[executionParams.sessionKey ?? ""] ??
            executionParams.getActiveSessionEntry(),
          assertCurrent: () => {
            execution.deferredLifecycle.signal?.throwIfAborted();
            execution.preparedRunAdmission.assertSourceCurrent();
          },
          userMessage: executionParams.followupRun.prompt,
          opts: executionParams.opts,
          disabled: run.modelSelectionLocked,
        }),
      },
      runInference,
    );
  } finally {
    try {
      await execution.close();
    } finally {
      try {
        runInference?.dispose();
      } finally {
        await workspaceLease?.release();
      }
    }
  }
}

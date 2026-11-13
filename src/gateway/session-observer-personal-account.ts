import { readPreparedSessionEntryChange } from "../config/sessions/session-accessor.sqlite-entry-cache-publication-state.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import {
  prepareSessionRowPublicationScope,
  sessionChangeAffectsStoredRow,
} from "../sessions/session-row-facts.js";
import { hasUserModelAuthProfileId } from "../state/user-model-account-id.js";
import { createSessionObserverModelSlots } from "./session-observer-model-slots.js";
import {
  isSameSessionObserverLifecycle,
  rememberSessionObserverDisabledRun,
  type SessionObserverDeps,
  type SessionObserverState,
} from "./session-observer-model.js";

type ReadSession = NonNullable<SessionObserverDeps["readSession"]>;

export function createSessionObserverModelCustody(params: {
  states: Map<string, SessionObserverState>;
  disabledRuns: Set<string>;
  clearTimeoutFn: typeof clearTimeout;
  maxSessions: number;
  resolveUtilityModelRef: (agentId: string) => string | undefined;
  resolveStorePath: (agentId: string) => string;
}) {
  const demote = (state: SessionObserverState): void => {
    if (state.timer) {
      params.clearTimeoutFn(state.timer);
      state.timer = undefined;
    }
    modelSlots.invalidateRequest(state);
    state.preparedPromise = undefined;
    state.utilityModelRef = undefined;
    state.consecutiveFailures = 0;
  };
  const modelSlots = createSessionObserverModelSlots({
    states: params.states,
    maxSessions: params.maxSessions,
    resolve: params.resolveUtilityModelRef,
    demote,
  });
  const disable = (state: SessionObserverState) => {
    rememberSessionObserverDisabledRun(params.disabledRuns, state.runId);
    demote(state);
  };
  const unsubscribe = sessionChanges.subscribeFacts((change) => {
    for (const state of params.states.values()) {
      if (
        !state.utilityModelRef ||
        !sessionChangeAffectsStoredRow(change, {
          ...prepareSessionRowPublicationScope([params.resolveStorePath(state.agentId)]),
          agentId: state.agentId,
          sessionKeys: [state.sessionKey],
        })
      ) {
        continue;
      }
      const receipt = readPreparedSessionEntryChange(change, state.sessionKey);
      if (
        hasUserModelAuthProfileId((receipt?.fullEntry ?? receipt?.entry)?.authProfileOverride) ||
        change.factsInvalidated ||
        (receipt && !receipt.entry)
      ) {
        disable(state);
      }
    }
  });
  return { modelSlots, demote, disable, unsubscribe };
}

type ObservedAudience = "direct" | "broad" | "none";

export function createSessionObserverPersonalAccountCurrentGuard(params: {
  base: (state: SessionObserverState, audience?: ObservedAudience) => boolean;
  hasResidentSession: boolean;
  readSession: ReadSession;
}) {
  return (state: SessionObserverState, audience?: ObservedAudience): boolean => {
    const current = params.base(state, audience);
    if (!current || !params.hasResidentSession) {
      return current;
    }
    const session = params.readSession(state.sessionKey, state.agentId);
    return (
      isSameSessionObserverLifecycle(state, session) &&
      !hasUserModelAuthProfileId(session?.authProfileOverride)
    );
  };
}

export function sessionObserverAllowsUtilityModel(
  session: ReturnType<ReadSession> | undefined,
): boolean {
  return !hasUserModelAuthProfileId(session?.authProfileOverride);
}

export function disablePersonalAccountObserverRun(
  disabledRuns: Set<string>,
  runId: string,
  session: ReturnType<ReadSession>,
): boolean {
  if (sessionObserverAllowsUtilityModel(session)) {
    return false;
  }
  rememberSessionObserverDisabledRun(disabledRuns, runId);
  return true;
}

export const personalAccountObserver = {
  createCustody: createSessionObserverModelCustody,
  createCurrentGuard: createSessionObserverPersonalAccountCurrentGuard,
  disableRun: disablePersonalAccountObserverRun,
};

import { getPluginRuntimeGatewayRequestScope } from "./gateway-request-scope.js";

const PERSONAL_ACCOUNT_AUXILIARY_INFERENCE_ERROR =
  "Auxiliary plugin inference is unavailable for a personal model-account turn.";

/** Fail closed before a plugin can select an operator-owned model credential. */
export function assertPersonalAccountAuxiliaryInferenceAllowed(): void {
  if (getPluginRuntimeGatewayRequestScope()?.personalModelAuthProfileId) {
    throw new Error(PERSONAL_ACCOUNT_AUXILIARY_INFERENCE_ERROR);
  }
}

import { textResult } from "openclaw/plugin-sdk/tool-results";

export function buildMattermostReactionResult(params: {
  remove: boolean;
  emojiName: string;
  postId: string;
}) {
  const { remove, emojiName, postId } = params;
  return textResult(
    remove
      ? `Removed reaction :${emojiName}: from ${postId}`
      : `Reacted with :${emojiName}: on ${postId}`,
    remove
      ? { ok: true, changed: true, removed: emojiName }
      : { ok: true, changed: true, added: emojiName },
  );
}

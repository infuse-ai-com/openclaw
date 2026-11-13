// Runs the complete lint pipeline with the selected installed toolchain.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { main as runLitRatchet } from "./check-control-ui-lit-ratchet.mts";
import { booleanFlag, parseFlagArgs, stringFlag } from "./lib/arg-utils.mts";
import { runWithFailedTrailer } from "./lib/failed-trailer.mts";
import { resolveRepoToolBinPath } from "./lib/local-check-runtime.mts";
import { runManagedCommand } from "./lib/managed-child-process.mts";
import { isOxlintSourcePath, main as runOxlintShards } from "./run-oxlint-shards.mts";
import { runStylelint } from "./run-stylelint.mts";

await runWithFailedTrailer("lint", async () => {
  const args = parseFlagArgs(
    process.argv.slice(2),
    { base: "", changed: false, staged: false, oxlint: new Array<string>() },
    [
      stringFlag("--base", "base"),
      booleanFlag("--changed", "changed", true, { repeatable: true }),
      booleanFlag("--staged", "staged"),
    ],
    {
      onUnhandledArg(arg, parsed) {
        parsed.oxlint.push(arg);
        return "handled";
      },
    },
  );
  const base = args.base || (!args.staged ? process.env.CHECKOUT_BASE_SHA : undefined);
  if (args.changed && !base) {
    throw new Error("--changed requires --base or CHECKOUT_BASE_SHA");
  }
  let failure = 0;
  const collect = (status: number) => {
    // Timeouts and cancellation deliberately stop admitting new work.
    const stopped = status === 124 || status >= 128;
    failure = stopped ? status : failure || status;
    process.exitCode = failure;
    return stopped;
  };
  if (
    collect(
      runLitRatchet(process.cwd(), [
        ...(args.staged ? ["--staged"] : []),
        ...(base ? ["--base", base] : []),
      ]),
    )
  ) {
    return;
  }
  const tsxPath = resolveRepoToolBinPath("tsx");
  const tsxImportSpecifier = pathToFileURL(createRequire(tsxPath).resolve("tsx")).href;

  // Invoke directly: pnpm through a linked node_modules can reconcile its owner's install.
  if (
    collect(
      await runManagedCommand({
        bin: process.execPath,
        args: [
          "--import",
          tsxImportSpecifier,
          path.resolve("scripts", "control-ui-i18n-verify.ts"),
          "verify",
        ],
        env: process.env,
        requireProcessTreeExit: process.platform !== "win32",
      }),
    )
  ) {
    return;
  }
  // Compose the batch so cancellation and final reporting remain with this process.
  const changedFiles = args.changed && base ? listChangedOxlintFiles(base) : undefined;
  const oxlintStatus =
    changedFiles?.length === 0
      ? 0
      : await runOxlintShards([
          ...(changedFiles ? ["--files-json", JSON.stringify(changedFiles)] : []),
          ...args.oxlint,
        ]);
  if (collect(oxlintStatus)) {
    return;
  }
  // Oxlint cannot see plain stylesheets or css`` templates in Lit components.
  collect(
    await runStylelint(["ui/src/**/*.css", "ui/src/**/*.{ts,tsx}", "ui/public/themes/*.css"]),
  );
});

function listChangedOxlintFiles(base: string) {
  const tracked = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", base, "--"], {
    encoding: "utf8",
  }).split("\n");
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  }).split("\0");
  return [...new Set([...tracked, ...untracked])]
    .filter((file) => isOxlintSourcePath(file, process.cwd()))
    .toSorted((left, right) => left.localeCompare(right));
}

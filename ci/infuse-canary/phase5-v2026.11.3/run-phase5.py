#!/usr/bin/env python3
"""Run the resource-heavy v2026.11.3 Phase 5 lanes on one pinned Blacksmith host."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile


ROOT = Path(__file__).resolve().parent


def require(value: object, message: str) -> None:
    if not value:
        raise ValueError(message)


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(arguments: list[str], *, cwd: Path | None = None, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        arguments,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    require(result.returncode == 0, f"command failed ({result.returncode}): {arguments[0]} {arguments[1] if len(arguments) > 1 else ''}\n{result.stderr[-2000:]}")
    return result


def extract(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as handle:
        for member in handle.getmembers():
            member_path = Path(member.name)
            require(not member_path.is_absolute() and ".." not in member_path.parts, "fixture archive contains an unsafe path")
        handle.extractall(destination)


def verify_repository(path: Path, commit: str) -> None:
    require(run(["git", "-C", str(path), "rev-parse", "HEAD"], timeout=30).stdout.strip() == commit, "fixture repository commit differs")
    require(not run(["git", "-C", str(path), "status", "--porcelain", "--untracked-files=all"], timeout=60).stdout.strip(), "fixture repository is dirty")


def expose_fixture(repository: Path) -> None:
    fixture = repository / "phase5-fixtures/v2026.11.3"
    for directory in (repository, repository / "phase5-fixtures", fixture):
        directory.chmod(stat.S_IMODE(directory.stat().st_mode) | 0o055)
    for path in fixture.rglob("*"):
        permission = 0o055 if path.is_dir() else 0o044
        path.chmod(stat.S_IMODE(path.stat().st_mode) | permission)


def hydrate_packages(artifact_root: Path, plan_root: Path) -> None:
    plan = read_json(plan_root / "phase5-plan.json")
    require(isinstance(plan, dict) and isinstance(plan.get("packages"), list), "invalid Phase 5 plan package closure")
    packages = plan_root / "packages"
    require(not packages.exists(), "Phase 5 plan packages already exist")
    packages.mkdir(mode=0o755)
    expected = {item["file"]: item["sha256"] for item in plan["packages"]}
    found = [path for path in artifact_root.rglob("*.tgz") if path.is_file()]
    require({path.name for path in found} == set(expected) and len(found) == len(expected), "hosted artifact package closure differs")
    for source in found:
        require(sha256(source) == expected[source.name], "hosted artifact package digest differs: " + source.name)
        shutil.copyfile(source, packages / source.name)


def docker_preflight(images: list[str]) -> dict[str, object]:
    info_result = run(["docker", "info", "--format", "{{json .}}"], timeout=60)
    info = json.loads(info_result.stdout)
    require(info.get("NCPU", 0) >= 8, "Blacksmith Docker host has fewer than eight CPUs")
    require(info.get("MemTotal", 0) >= 11 * 1024**3, "Blacksmith Docker host has less than 11 GiB")
    for image in images:
        run(["docker", "pull", "--platform", "linux/amd64", image], timeout=1800)
        inspected = json.loads(run(["docker", "image", "inspect", image], timeout=60).stdout)
        require(len(inspected) == 1 and inspected[0].get("Os") == "linux" and inspected[0].get("Architecture") == "amd64", "pinned image platform differs: " + image)
    return {"cpus": info["NCPU"], "memoryBytes": info["MemTotal"], "architecture": info.get("Architecture")}


def fixture_mount_preflight(work: Path, node_image: str) -> None:
    for repository in ("studio", "swarm"):
        fixture = work / repository / "phase5-fixtures/v2026.11.3"
        run([
            "docker", "run", "--rm", "--pull", "never", "--platform", "linux/amd64",
            "--network", "none", "--user", "1000:1000", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--mount", f"type=bind,src={fixture},dst=/fixture,readonly",
            node_image, "sh", "-c", "test -r /fixture/proxy.mjs && test -r /fixture/run_lane.py",
        ], timeout=120)


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", required=True)
    parser.add_argument("--controller-sha", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    artifact_root = Path(args.artifact_root).resolve(strict=True)
    require(len(args.controller_sha) == 40 and all(character in "0123456789abcdef" for character in args.controller_sha), "invalid qualification controller SHA")
    output = Path(args.output).resolve()
    require(not output.exists(), "output already exists")
    output.mkdir(parents=True, mode=0o755)
    controller_logs = output / "controller-logs"
    controller_logs.mkdir(mode=0o700)
    evidence_root = output / "evidence"
    evidence_root.mkdir(mode=0o700)
    work = output / "work"
    work.mkdir(mode=0o755)

    config = read_json(ROOT / "execution.json")
    require(isinstance(config, dict) and config.get("schema") == 1, "unsupported execution config")
    require(config.get("repository") == "infuse-ai-com/openclaw", "execution repository differs")
    for relative, expected in config["files"].items():
        require(sha256(ROOT / relative) == expected, "pinned controller input differs: " + relative)

    extract(ROOT / "inputs/builder-fixture.tgz", work)
    extract(ROOT / "inputs/studio-fixture.tgz", work)
    extract(ROOT / "inputs/swarm-fixture.tgz", work)
    for name, commit in config["repositories"].items():
        verify_repository(work / name, commit)
    expose_fixture(work / "studio")
    expose_fixture(work / "swarm")

    plan_root = work / "plan"
    shutil.copytree(ROOT / "plan", plan_root)
    hydrate_packages(artifact_root, plan_root)
    host = docker_preflight(config["images"])
    fixture_mount_preflight(work, config["images"][0])

    adapter = work / "builder/phase5-adapters/run-adapter.py"
    manifest = ROOT / "manifest.json"
    fixtures = {
        "managedNative": (work / "studio/phase5-fixtures/v2026.11.3", ROOT / "inputs/studio-inventory.json"),
        "amd64": (work / "swarm/phase5-fixtures/v2026.11.3", ROOT / "inputs/swarm-inventory.json"),
        "localImage": (work / "swarm/phase5-fixtures/v2026.11.3", ROOT / "inputs/swarm-inventory.json"),
    }
    statuses: dict[str, str] = {}
    for lane in config["lanes"]:
        fixture_root, inventory = fixtures[lane]
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(adapter),
                "--manifest",
                str(manifest),
                "--plan-dir",
                str(plan_root),
                "--lane",
                lane,
                "--fixture-root",
                str(fixture_root),
                "--fixture-inventory",
                str(inventory),
                "--output",
                str(evidence_root / lane),
            ],
            stdin=subprocess.DEVNULL,
            text=True,
            capture_output=True,
            timeout=3 * 60 * 60,
            check=False,
        )
        (controller_logs / f"{lane}.stdout.log").write_text(result.stdout, encoding="utf-8")
        (controller_logs / f"{lane}.stderr.log").write_text(result.stderr, encoding="utf-8")
        receipt_path = evidence_root / lane / "receipt.json"
        status = "missing"
        if receipt_path.is_file():
            receipt = read_json(receipt_path)
            if isinstance(receipt, dict):
                status = str(receipt.get("status", "invalid"))
        statuses[lane] = status

    passed = all(status == "passed" for status in statuses.values())
    write_json(output / "controller-receipt.json", {
        "schema": 1,
        "status": "passed" if passed else "failed",
        "candidateId": config["candidateId"],
        "sourceCommit": config["sourceCommit"],
        "qualificationAttempt": config["qualificationAttempt"],
        "qualificationControllerCommit": args.controller_sha,
        "phase5PlanSha256": config["files"]["plan/phase5-plan.json"],
        "hostedArtifact": config["hostedArtifact"],
        "host": host,
        "lanes": statuses,
        "published": False,
        "deployed": False,
    })
    shutil.rmtree(work)
    print("passed" if passed else "failed")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

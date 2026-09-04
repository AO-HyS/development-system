import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexSkillProbeEvidence,
  buildCodexSkillProbeInvocations,
  invocationDigest,
  observedSkillReadEvent,
  runCodexSkillProbeSequence,
  runSkillProbeProcess,
  skillProbeContracts,
} from "../src/skill-probe-runtime.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function message(text) {
  return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } })}\n`;
}

const fixtureHome = "/isolated-home";
const fixtureInvocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo", home: fixtureHome });

/** @param {string} skillName */
function fixtureSkillPath(skillName) {
  return `${fixtureHome}/.agents/skills/${skillName}/SKILL.md`;
}

/**
 * Fixture JSONL command_execution for a successful read of the exact
 * installed SKILL.md path with the matching frontmatter name.
 * @param {string} skillName @param {{command?: string, exitCode?: number, output?: string}} [overrides]
 */
function commandExecution(skillName, overrides = {}) {
  const item = {
    type: "command_execution",
    command: `cat ${fixtureSkillPath(skillName)}`,
    exit_code: 0,
    aggregated_output: `---\nname: ${skillName}\ndescription: Fixture skill instructions.\n---\nBody.\n`,
  };
  if (overrides.command !== undefined) item.command = overrides.command;
  if (overrides.exitCode !== undefined) item.exit_code = overrides.exitCode;
  if (overrides.output !== undefined) item.aggregated_output = overrides.output;
  return `${JSON.stringify({ type: "item.completed", item })}\n`;
}

/** Successful skill turn: observed read plus the final agent response. @param {string} skillName @param {string} response */
function skillTurn(skillName, response) {
  return `${commandExecution(skillName)}${message(response)}`;
}

const probeNames = skillProbeContracts.map((contract) => contract.logicalName);

/** Minimal live responses that satisfy every contract's catalog, load, and influence assertions. */
const liveResponses = {
  research:
    "A background agent uses primary sources and creates one markdown file somewhere sensible and will say where.",
  "behavioral-evidence":
    "Tests are subordinate evidence; weakened assertions or updated snapshots that only make the run green justify nothing, and independent verification derives its oracle from the accepted objective. A green result alone justifies nothing.",
  "simplify-code":
    "The mandatory deletion pass covers production code and test code and reports what was deleted, kept, and for what remains, why it must remain.",
  "install-anti-slop":
    "Use scripts/install.mjs; it refuses absolute paths, parent traversal, and symlink escape targets before copying.",
};

test("probe contracts cover research and the three anti-slop capabilities", () => {
  assert.deepEqual(probeNames, ["research", "behavioral-evidence", "simplify-code", "install-anti-slop"]);
  for (const contract of skillProbeContracts) {
    assert.ok(contract.skillPrompt.startsWith(`$${contract.logicalName}`), contract.logicalName);
    assert.ok(contract.behaviorSignature.length > 0, contract.logicalName);
    assert.ok(contract.loadSignature.length > 0, contract.logicalName);
    assert.ok(
      contract.loadPathMarkers.some((marker) => marker.startsWith(".agents/skills/")),
      contract.logicalName,
    );
  }
});

test("Codex skill probe invocations are ephemeral, read-only, bounded surfaces without Factory", () => {
  const invocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo", home: fixtureHome });
  assert.deepEqual(Object.keys(invocations), ["version", "skills"]);
  assert.deepEqual(Object.keys(invocations.skills), probeNames);
  for (const contract of skillProbeContracts) {
    for (const invocation of [invocations.skills[contract.logicalName].catalog, invocations.skills[contract.logicalName].skill]) {
      assert.equal(invocation.executable, "/opt/codex");
      assert.ok(invocation.args.includes("--ephemeral"));
      assert.deepEqual(
        invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2),
        ["--sandbox", "read-only"],
      );
      assert.ok(invocation.args.includes("never"));
      assert.ok(invocation.args.includes("/repo"));
      assert.doesNotMatch(invocation.args.join(" "), /factory|droid/iu);
    }
    assert.ok(
      invocations.skills[contract.logicalName].skill.args.at(-1).includes(fixtureSkillPath(contract.logicalName)),
      `${contract.logicalName} probe must name its exact absolute installed path`,
    );
  }
});

test("Codex skill probe observations run sequentially to avoid exit-zero empty turns", async () => {
  const invocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo", home: fixtureHome });
  const calls = [];
  let active = false;
  const result = await runCodexSkillProbeSequence({
    invocations,
    home: fixtureHome,
    execute: async (invocation) => {
      assert.equal(active, false, "probe invocations overlapped");
      active = true;
      calls.push(invocation);
      await Promise.resolve();
      active = false;
      let stdout = "codex 1";
      for (const contract of skillProbeContracts) {
        const pair = invocations.skills[contract.logicalName];
        if (invocation === pair.catalog) stdout = message(contract.logicalName);
        if (invocation === pair.skill) stdout = skillTurn(contract.logicalName, liveResponses[contract.logicalName]);
      }
      return { executable: invocation.executable, marker: calls.length, exitCode: 0, stdout };
    },
  });
  assert.deepEqual(calls, [
    invocations.version,
    ...skillProbeContracts.flatMap((contract) => {
      const pair = invocations.skills[contract.logicalName];
      return [pair.catalog, pair.skill];
    }),
  ]);
  for (const contract of skillProbeContracts) {
    assert.equal(result.observations[contract.logicalName].attempts.retriedFailedAssertions, 0);
  }
});

test("Codex skill probe retries only an exit-zero observation missing its required assertion", async () => {
  const invocations = buildCodexSkillProbeInvocations({ codexPath: "/opt/codex", repositoryRoot: "/repo", home: fixtureHome });
  const attempts = new Map();
  const keyFor = new Map([[invocations.version, "version"]]);
  for (const contract of skillProbeContracts) {
    const pair = invocations.skills[contract.logicalName];
    keyFor.set(pair.catalog, `${contract.logicalName}-catalog`);
    keyFor.set(pair.skill, `${contract.logicalName}-skill`);
  }
  const result = await runCodexSkillProbeSequence({
    invocations,
    home: fixtureHome,
    execute: async (invocation) => {
      const key = keyFor.get(invocation);
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      if (key === "research-skill" && count === 1) return { exitCode: 0, stdout: message("I read a skill."), stderr: "" };
      if (key === "research-catalog" && count === 1) return { exitCode: 0, stdout: "", stderr: "" };
      if (key === "version") return { exitCode: 0, stdout: "codex 1", stderr: "" };
      if (key.endsWith("-catalog")) return { exitCode: 0, stdout: message(key.replace("-catalog", "")), stderr: "" };
      return { exitCode: 0, stdout: skillTurn(key.replace("-skill", ""), liveResponses[key.replace("-skill", "")]), stderr: "" };
    },
  });
  assert.equal(attempts.get("research-catalog"), 2);
  assert.equal(attempts.get("research-skill"), 2);
  for (const contract of skillProbeContracts.slice(1)) {
    assert.equal(attempts.get(`${contract.logicalName}-catalog`), 1);
    assert.equal(attempts.get(`${contract.logicalName}-skill`), 1);
  }
  assert.equal(result.observations["behavioral-evidence"].attempts.retriedFailedAssertions, 0);
});

test("the process runner kills a stalled probe within its explicit timeout", async () => {
  const startedAt = Date.now();
  const result = await runSkillProbeProcess({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10_000)"],
    cwd: process.cwd(),
    timeoutMs: 40,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(Date.now() - startedAt < 2_000, true);
});

test("runSkillProbeProcess returns a structured invocation and its digest", async () => {
  const result = await runSkillProbeProcess({
    executable: process.execPath,
    args: ["-e", "console.log('ok')"],
    cwd: process.cwd(),
    env: { HOME: "/tmp/home" },
    timeoutMs: 5000,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.structuredInvocation, {
    executable: process.execPath,
    argv: ["-e", "console.log('ok')"],
    cwd: process.cwd(),
    env: { HOME: "/tmp/home" },
  });
  assert.equal(result.invocationSha256, invocationDigest(result.structuredInvocation));
});

test("structured invocation digests bind executable, argv boundaries, cwd, and security-relevant environment", () => {
  const base = { executable: "/opt/codex", argv: ["exec", "probe"], cwd: "/repo", env: { HOME: "/home" } };
  const baseline = invocationDigest(base);
  assert.match(baseline, /^[a-f0-9]{64}$/u);
  const joinedArgv = invocationDigest({ ...base, argv: ["exec probe"] });
  assert.notEqual(baseline, joinedArgv, "joined argv must not match separated argv");
  const differentExecutable = invocationDigest({ ...base, executable: "/other/codex" });
  assert.notEqual(baseline, differentExecutable);
  const differentCwd = invocationDigest({ ...base, cwd: "/other" });
  assert.notEqual(baseline, differentCwd);
  const differentHome = invocationDigest({ ...base, env: { HOME: "/other" } });
  assert.notEqual(baseline, differentHome);
  const differentPath = invocationDigest({ ...base, env: { HOME: "/home", PATH: "/bin" } });
  assert.notEqual(baseline, differentPath);
  // CODEX_HOME selects the Codex configuration and skill-discovery root, so
  // changing it must change the invocation digest.
  const codexHomeA = invocationDigest({ ...base, env: { HOME: "/home", CODEX_HOME: "/codex-a" } });
  const codexHomeB = invocationDigest({ ...base, env: { HOME: "/home", CODEX_HOME: "/codex-b" } });
  assert.notEqual(baseline, codexHomeA, "adding CODEX_HOME must change the digest");
  assert.notEqual(codexHomeA, codexHomeB, "changing CODEX_HOME must change the digest");
  // Non-relevant environment variables are ignored for the digest: adding a
  // secret env var to the same safe baseline does not change the digest.
  const nonRelevantEnv = invocationDigest({ ...base, env: { HOME: "/home", OPENAI_API_KEY: "secret" } });
  assert.equal(baseline, nonRelevantEnv);
});

function evidenceInput(overrides = {}) {
  const env = { HOME: fixtureHome };
  const observations = Object.fromEntries(skillProbeContracts.map((contract) => {
    const catalogInvocation = fixtureInvocations.skills[contract.logicalName].catalog;
    const skillInvocation = fixtureInvocations.skills[contract.logicalName].skill;
    return [
      contract.logicalName,
      {
        catalog: {
          exitCode: 0,
          stdout: message(contract.logicalName),
          stderr: "",
          command: `codex catalog ${contract.logicalName}`,
          structuredInvocation: { executable: catalogInvocation.executable, argv: catalogInvocation.args, cwd: "/repo", env },
          errorCode: null,
        },
        skill: {
          exitCode: 0,
          stdout: skillTurn(contract.logicalName, liveResponses[contract.logicalName]),
          stderr: "",
          command: `codex skill ${contract.logicalName}`,
          structuredInvocation: { executable: skillInvocation.executable, argv: skillInvocation.args, cwd: "/repo", env },
          errorCode: null,
        },
        attempts: { version: 1, catalog: 1, skill: 1, retriedFailedAssertions: 0 },
      },
    ];
  }));
  return {
    catalogVersion: "0.24.0",
    sourceCommit: "a".repeat(40),
    home: fixtureHome,
    structuralCatalogLogicalSkills: 63,
    installedHashes: Object.fromEntries(probeNames.map((name) => [`${name}.codex`, "b".repeat(64)])),
    generatedAt: "2026-08-14T00:00:00.000Z",
    codexVersion: { exitCode: 0, stdout: "codex-cli 1.2.3\n", errorCode: null, timedOut: false, overflow: false },
    observations,
    ...overrides,
  };
}

test("fixture evidence proves exact shape, influence, and per-skill installed hashes", () => {
  const input = evidenceInput();
  const healthy = buildCodexSkillProbeEvidence(input);
  assert.equal(healthy.schemaVersion, 2);
  assert.equal(healthy.probeSucceeded, true);
  assert.deepEqual(healthy.evidenceScope.liveInfluenceSkills, probeNames);
  assert.deepEqual(Object.keys(healthy.installedHashes), probeNames.map((name) => `${name}.codex`));
  for (const contract of skillProbeContracts) {
    const observed = healthy.codex[contract.logicalName];
    assert.equal(observed.catalogued, true, contract.logicalName);
    assert.equal(observed.loaded, true, contract.logicalName);
    assert.equal(observed.influenced, true, contract.logicalName);
    assert.equal(observed.skillRead.observed, true, contract.logicalName);
    assert.equal(observed.skillRead.commandProof, "cat-exact-installed-skill", contract.logicalName);
    assert.equal(observed.skillRead.path, fixtureSkillPath(contract.logicalName), contract.logicalName);
    assert.equal(observed.skillRead.frontmatterName, contract.logicalName, contract.logicalName);
    assert.equal(observed.skillRead.exitCode, 0, contract.logicalName);
    assert.equal(Object.hasOwn(observed.skillRead, "command"), false, contract.logicalName);
    for (const digest of [
      observed.skillRead.commandEventSha256,
      observed.skillRead.commandSha256,
      observed.skillRead.frontmatterSha256,
      observed.invocationSha256,
      observed.catalogInvocationSha256,
      observed.responseSha256,
      observed.catalogResponseSha256,
    ]) assert.match(digest, /^[a-f0-9]{64}$/u, contract.logicalName);
    assert.equal(Object.hasOwn(observed, "response"), false, contract.logicalName);
    assert.equal(Object.hasOwn(observed, "catalogResponse"), false, contract.logicalName);
    // Durable evidence persists only the exact digest schema marker and
    // SHA-256 digests; the structured invocation itself (whose argv carries
    // the raw prompt) stays ephemeral on the process result.
    assert.equal(observed.invocationDigestSchema, "canonical-executable-argv-cwd-safe-env-v1", contract.logicalName);
    assert.equal(Object.hasOwn(observed, "structuredInvocation"), false, contract.logicalName);
    assert.equal(Object.hasOwn(observed, "catalogStructuredInvocation"), false, contract.logicalName);
    const ephemeralSkill = input.observations[contract.logicalName].skill.structuredInvocation;
    const ephemeralCatalog = input.observations[contract.logicalName].catalog.structuredInvocation;
    assert.ok(isRecord(ephemeralSkill), contract.logicalName);
    assert.ok(isRecord(ephemeralCatalog), contract.logicalName);
    assert.equal(observed.invocationSha256, invocationDigest(ephemeralSkill), contract.logicalName);
    assert.equal(observed.catalogInvocationSha256, invocationDigest(ephemeralCatalog), contract.logicalName);
    assert.deepEqual(observed.versionObservation, { exitCode: 0, timedOut: false, overflow: false, failure: null });
    assert.deepEqual(observed.observationAttempts, { version: 1, catalog: 1, skill: 1, retriedFailedAssertions: 0 });
  }
  assert.equal("factory" in healthy, false);
});

test("serialized durable evidence contains no prompt text, raw argv, or secret environment values", () => {
  const input = evidenceInput();
  // A secret environment variable rides on an ephemeral structured invocation
  // and must never reach the persisted evidence.
  input.observations.research.skill.structuredInvocation = {
    ...input.observations.research.skill.structuredInvocation,
    env: { HOME: fixtureHome, OPENAI_API_KEY: "sk-secret-test-value" },
  };
  const serialized = JSON.stringify(buildCodexSkillProbeEvidence(input));
  // Skill and catalog prompt text (each skill's argv carries its prompt).
  for (const contract of skillProbeContracts) {
    assert.equal(serialized.includes(contract.skillPrompt), false, contract.logicalName);
    assert.equal(serialized.includes(contract.catalogPrompt), false, contract.logicalName);
  }
  for (const promptPhrase of [
    "Read the full skill instructions from the exact installed file",
    "Without opening or activating a skill",
  ]) {
    assert.equal(serialized.includes(promptPhrase), false, promptPhrase);
  }
  // Raw argv markers from the probe invocations.
  for (const argvMarker of ["--ephemeral", "--skip-git-repo-check", "--sandbox"]) {
    assert.equal(serialized.includes(argvMarker), false, argvMarker);
  }
  // Secret environment values.
  assert.equal(serialized.includes("sk-secret-test-value"), false);
  assert.equal(serialized.includes("OPENAI_API_KEY"), false);
});

test("signature-complete prose without a successful skill read event never proves loading", () => {
  // The reviewer's exact negative case: the final response carries every
  // behavior-signature phrase, the process exits 0, and the catalog names the
  // skill, but no command_execution ever read the installed SKILL.md.
  const input = evidenceInput();
  for (const contract of skillProbeContracts) {
    input.observations[contract.logicalName].skill = {
      exitCode: 0,
      stdout: message(liveResponses[contract.logicalName]),
      stderr: "",
      command: `codex skill ${contract.logicalName}`,
      errorCode: null,
    };
  }
  const failed = buildCodexSkillProbeEvidence(input);
  assert.equal(failed.probeSucceeded, false);
  for (const contract of skillProbeContracts) {
    const observed = failed.codex[contract.logicalName];
    assert.equal(observed.loaded, false, contract.logicalName);
    assert.equal(observed.influenced, false, contract.logicalName);
    assert.equal(observed.catalogued, true, contract.logicalName);
    assert.equal(observed.skillRead.observed, false, contract.logicalName);
    assert.equal(Object.hasOwn(observed.skillRead, "command"), false, contract.logicalName);
  }
  // A load-signature phrase in the response is equally insufficient.
  const phraseOnly = evidenceInput();
  phraseOnly.observations.research.skill = {
    exitCode: 0,
    stdout: message("The fallback applies somewhere sensible and I will say where."),
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  const phraseResult = buildCodexSkillProbeEvidence(phraseOnly);
  assert.equal(phraseResult.codex.research.loaded, false);
  assert.equal(phraseResult.codex.research.influenced, false);
});

test("a read of the wrong path, a failed read, or wrong frontmatter does not prove loading", () => {
  const wrongPath = evidenceInput();
  wrongPath.observations.research.skill = {
    exitCode: 0,
    stdout: `${commandExecution("research", { command: `cat ${fixtureSkillPath("other-skill")}`, output: "---\nname: research\n---\n" })}${message(liveResponses.research)}`,
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  const wrongPathResult = buildCodexSkillProbeEvidence(wrongPath);
  assert.equal(wrongPathResult.codex.research.loaded, false);
  assert.equal(wrongPathResult.codex.research.influenced, false);

  const wrongDirectory = evidenceInput();
  wrongDirectory.observations.research.skill = {
    exitCode: 0,
    stdout: `${commandExecution("research", { command: "cat skills/research/SKILL.md", output: "---\nname: research\n---\n" })}${message(liveResponses.research)}`,
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  assert.equal(buildCodexSkillProbeEvidence(wrongDirectory).codex.research.loaded, false);

  const wrongAbsoluteHome = evidenceInput();
  wrongAbsoluteHome.observations.research.skill = {
    exitCode: 0,
    stdout: `${commandExecution("research", { command: "cat /wrong-home/.agents/skills/research/SKILL.md", output: "---\nname: research\n---\n" })}${message(liveResponses.research)}`,
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  assert.equal(buildCodexSkillProbeEvidence(wrongAbsoluteHome).codex.research.loaded, false);

  const failedRead = evidenceInput();
  failedRead.observations.research.skill = {
    exitCode: 0,
    stdout: `${commandExecution("research", { exitCode: 1, output: `cat: ${fixtureSkillPath("research")}: No such file or directory` })}${message(liveResponses.research)}`,
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  const failedReadResult = buildCodexSkillProbeEvidence(failedRead);
  assert.equal(failedReadResult.codex.research.loaded, false);
  assert.equal(failedReadResult.codex.research.influenced, false);
  assert.equal(failedReadResult.probeSucceeded, false);

  const wrongFrontmatter = evidenceInput();
  wrongFrontmatter.observations.research.skill = {
    exitCode: 0,
    stdout: `${commandExecution("research", { output: "---\nname: some-other-skill\n---\nBody.\n" })}${message(liveResponses.research)}`,
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  const wrongFrontmatterResult = buildCodexSkillProbeEvidence(wrongFrontmatter);
  assert.equal(wrongFrontmatterResult.codex.research.loaded, false);
  assert.equal(wrongFrontmatterResult.codex.research.influenced, false);
  assert.equal(wrongFrontmatterResult.probeSucceeded, false);

  // A path echoed in prose without an observed command_execution is not proof.
  const proseOnly = evidenceInput();
  proseOnly.observations.research.skill = {
    exitCode: 0,
    stdout: `${message(`I read ${fixtureSkillPath("research")} and will create a markdown file somewhere sensible.`)}`,
    stderr: "",
    command: "codex skill research",
    errorCode: null,
  };
  assert.equal(buildCodexSkillProbeEvidence(proseOnly).codex.research.loaded, false);
});

test("a failed subprocess fails the probe and sanitizes every response", () => {
  const input = evidenceInput();
  input.observations["simplify-code"].skill = {
    exitCode: null, stdout: "", stderr: "token=secret-value https://private.example/path?q=1",
    command: "codex skill simplify-code", errorCode: "TIMEOUT", timedOut: true,
  };
  const failed = buildCodexSkillProbeEvidence(input);
  assert.equal(failed.probeSucceeded, false);
  assert.equal(failed.codex["simplify-code"].influenced, false);
  assert.ok(failed.codex["simplify-code"].failures.length > 0);
  assert.doesNotMatch(JSON.stringify(failed), /secret-value|private\.example/iu);
  // Unrelated skills keep their healthy observations.
  assert.equal(failed.codex.research.influenced, true);
});

test("a failed version probe invalidates every skill observation", () => {
  const input = evidenceInput({ codexVersion: { exitCode: 2, stdout: "version failed", errorCode: null, timedOut: false, overflow: false } });
  const failed = buildCodexSkillProbeEvidence(input);
  assert.equal(failed.probeSucceeded, false);
  for (const contract of skillProbeContracts) {
    assert.ok(failed.codex[contract.logicalName].versionObservation.failure);
    assert.equal(Object.hasOwn(failed.codex[contract.logicalName], "response"), false);
    assert.match(failed.codex[contract.logicalName].responseSha256, /^[a-f0-9]{64}$/u);
  }
});

test("missing behavior signatures fail the influence assertion instead of passing vacuously", () => {
  const input = evidenceInput();
  input.observations["behavioral-evidence"].skill = {
    exitCode: 0, stdout: message("I read a skill."), stderr: "",
    command: "codex skill behavioral-evidence", errorCode: null,
  };
  const failed = buildCodexSkillProbeEvidence(input);
  assert.equal(failed.probeSucceeded, false);
  assert.equal(failed.codex["behavioral-evidence"].influenced, false);
  assert.equal(failed.codex["behavioral-evidence"].loaded, false);
});

test("load proof parses a real read command whose operand is exactly the installed SKILL.md", () => {
  const contract = skillProbeContracts.find((entry) => entry.logicalName === "research");
  const validOutput = "---\nname: research\ndescription: Fixture skill instructions.\n---\nBody.\n";
  /** @param {string} command @param {string} [output] @param {number} [exitCode] */
  const event = (command, output = validOutput, exitCode = 0) => `${JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", command, exit_code: exitCode, aggregated_output: output },
  })}\n`;
  const result = (stdout) => ({ stdout });
  const path = fixtureSkillPath("research");

  // Accepted real read shapes: plain cat, optional --, optionally via /bin/zsh -lc.
  for (const command of [
    `cat ${path}`,
    `cat -- ${path}`,
    `/bin/zsh -lc 'cat ${path}'`,
    `/bin/zsh -lc "cat -- ${path}"`,
  ]) {
    const receipt = observedSkillReadEvent(contract, result(event(command)), path);
    assert.deepEqual({
      schemaVersion: receipt.schemaVersion,
      observed: receipt.observed,
      command: receipt.command,
      commandProof: receipt.commandProof,
      path: receipt.path,
      frontmatterName: receipt.frontmatterName,
      exitCode: receipt.exitCode,
    }, {
      schemaVersion: 1,
      observed: true,
      command,
      commandProof: "cat-exact-installed-skill",
      path,
      frontmatterName: "research",
      exitCode: 0,
    }, command);
    for (const digest of [receipt.commandEventSha256, receipt.commandSha256, receipt.frontmatterSha256]) {
      assert.match(digest, /^[a-f0-9]{64}$/u, command);
    }
  }

  // Rejected: backups, extra suffixes, another skill, path-shape variants,
  // non-cat readers, extra operands, and options.
  for (const command of [
    `cat ${path}.backup`,
    `cat ${path}~`,
    `cat .agents/skills/research/SKILL.md.orig`,
    "cat /wrong-home/.agents/skills/research/SKILL.md",
    "cat .agents/skills/behavioral-evidence/SKILL.md",
    "cat skills/research/SKILL.md",
    `cat ./${path}`,
    `echo ${path}`,
    `printf ${path}`,
    `/bin/zsh -lc 'echo ${path}'`,
    `/bin/zsh -lc 'printf ${path}'`,
    `cat -n ${path}`,
    `cat ${path} .agents/skills/behavioral-evidence/SKILL.md`,
  ]) {
    assert.equal(observedSkillReadEvent(contract, result(event(command)), path).observed, false, command);
  }

  // Rejected: failed execution and unbalanced quoting fail closed.
  assert.equal(observedSkillReadEvent(contract, result(event(`cat ${path}`, validOutput, 1)), path).observed, false);
  assert.equal(observedSkillReadEvent(contract, result(event(`/bin/zsh -lc 'cat ${path}`)), path).observed, false);
});

test("aggregated_output must open a real frontmatter block whose name line matches", () => {
  const contract = skillProbeContracts.find((entry) => entry.logicalName === "research");
  /** @param {string} output */
  const observed = (output) => observedSkillReadEvent(contract, {
    stdout: `${JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", command: `cat ${fixtureSkillPath("research")}`, exit_code: 0, aggregated_output: output },
    })}\n`,
  }, fixtureSkillPath("research")).observed;

  assert.equal(observed("---\nname: research\ndescription: Fixture.\n---\nBody.\n"), true);
  // A closing delimiter at end-of-output is still a real block.
  assert.equal(observed("---\nname: research\ndescription: Fixture.\n---"), true);

  // Rejected: no frontmatter delimiters at all, even with a name line.
  assert.equal(observed("Some prose.\nname: research\nmore prose\n"), false);
  // Rejected: the name line only in ordinary body text after a real block.
  assert.equal(observed("---\ndescription: Fixture.\n---\nname: research\nBody.\n"), false);
  // Rejected: an unterminated frontmatter opening.
  assert.equal(observed("---\nname: research\n"), false);
  // Rejected: output that merely contains a frontmatter-shaped body.
  assert.equal(observed("body text\n---\nname: research\n---\n"), false);
  // Rejected: frontmatter carries another skill's name.
  assert.equal(observed("---\nname: simplify-code\n---\nBody.\n"), false);
});

test("a successful exact skill read without signature-bearing response is loaded but not influential", () => {
  const input = evidenceInput();
  for (const contract of skillProbeContracts) {
    input.observations[contract.logicalName].skill = {
      exitCode: 0,
      stdout: `${commandExecution(contract.logicalName)}${message("I read the installed instructions and am ready to proceed.")}`,
      stderr: "",
      command: `codex skill ${contract.logicalName}`,
      errorCode: null,
    };
  }
  const result = buildCodexSkillProbeEvidence(input);
  assert.equal(result.probeSucceeded, false);
  for (const contract of skillProbeContracts) {
    const observed = result.codex[contract.logicalName];
    assert.equal(observed.skillRead.observed, true, contract.logicalName);
    assert.equal(observed.loaded, true, contract.logicalName);
    assert.equal(observed.influenced, false, contract.logicalName);
  }
});

test("prompt echo without a successful read stays unloaded and uninfluential", () => {
  const input = evidenceInput();
  for (const contract of skillProbeContracts) {
    input.observations[contract.logicalName].skill = {
      exitCode: 0,
      stdout: message(contract.skillPrompt),
      stderr: "",
      command: `codex skill ${contract.logicalName}`,
      errorCode: null,
    };
  }
  const result = buildCodexSkillProbeEvidence(input);
  assert.equal(result.probeSucceeded, false);
  for (const contract of skillProbeContracts) {
    const observed = result.codex[contract.logicalName];
    assert.equal(observed.loaded, false, contract.logicalName);
    assert.equal(observed.influenced, false, contract.logicalName);
  }
});

test("no skill prompt contains any of its own behavior-signature phrases", () => {
  for (const contract of skillProbeContracts) {
    assert.ok(contract.behaviorSignature.length > 0, contract.logicalName);
    for (const phrase of contract.behaviorSignature) {
      assert.equal(
        contract.skillPrompt.toLowerCase().includes(phrase.toLowerCase()),
        false,
        `${contract.logicalName} skillPrompt leaks the signature phrase "${phrase}"`,
      );
    }
    // Catalog prompts stay a separate surface.
    assert.notEqual(contract.skillPrompt, contract.catalogPrompt);
  }
});

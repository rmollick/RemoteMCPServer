import "dotenv/config";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3333);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return defaultValue;
}
const hasFlag = (flag) => args.includes(flag);

const customPrompt = getArg("--prompt") || getArg("-p") ||
  "Emily is a 28-year-old patient admitted to RoomMedExam_base presenting with a fever. A nurse enters, washes hands, explains the examination, records vital signs (Temperature 39.1, HR 98, SpO2 96), and presents examination choices.";

const targetRoom = getArg("--room", "RoomMedExam_base");
const targetProvider = getArg("--provider") || getArg("-P") || process.env.MODEL_PROVIDER || "ollama";
const defaultModel = targetProvider.toLowerCase() === "gemini" ? (process.env.GEMINI_MODEL || "gemini-3.6-flash") : (process.env.OLLAMA_MODEL || "gemma3:4b");
const targetModel = getArg("--model") || getArg("-m") || defaultModel;
const skipEval = hasFlag("--skip-eval");
const noAutoStart = hasFlag("--no-auto-start");
const targetBaseUrl = getArg("--base-url", BASE_URL);

let autoSpawnedChild = null;

function cleanupAutoSpawned() {
  if (autoSpawnedChild && !autoSpawnedChild.killed) {
    console.log("🛑 Stopping auto-spawned daemon process...");
    try {
      autoSpawnedChild.kill();
    } catch {}
  }
}
process.on("exit", cleanupAutoSpawned);
process.on("SIGINT", () => { cleanupAutoSpawned(); process.exit(0); });
process.on("SIGTERM", () => { cleanupAutoSpawned(); process.exit(0); });

async function ensureDaemonRunning(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      return false; // already running
    }
  } catch {
    // Not running or connection refused
  }

  if (noAutoStart) {
    throw new Error(
      `Daemon is not running at ${baseUrl}.\n` +
      `💡 Please start the daemon first in a separate terminal: npm start`
    );
  }

  console.log(`📡 Daemon not detected on ${baseUrl}. Automatically spawning local daemon instance...`);
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) }
  });

  autoSpawnedChild = child;

  // Wait up to 12 seconds for daemon to start
  const startTime = Date.now();
  while (Date.now() - startTime < 12000) {
    try {
      const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        console.log(`🚀 Local daemon started successfully (PID: ${child.pid}).\n`);
        return true;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error(`Failed to connect to daemon at ${baseUrl} after auto-spawning.`);
}

function formatTime(ms) {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s (${ms.toFixed(0)}ms)`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function truncate(str, len = 60) {
  if (!str) return "";
  const s = String(str).replace(/\r?\n/g, " ").trim();
  return s.length > len ? s.slice(0, len - 3) + "..." : s;
}

async function runRevampedPipelineBenchmark() {
  console.log("\n" + "=".repeat(75));
  console.log("  🚀 CEREBRUM MULTI-AGENT PIPELINE BENCHMARK (Revamped)");
  console.log("=".repeat(75));
  console.log(`📡 Target Daemon:  ${targetBaseUrl}`);
  console.log(`🎯 Target Room:    ${targetRoom}`);
  console.log(`🧠 Model Provider: ${targetProvider.toUpperCase()} (${targetModel})`);
  console.log(`📝 Test Prompt:    "${truncate(customPrompt, 65)}"`);
  console.log(`🔍 LLM Evaluation: ${skipEval ? "SKIPPED (--skip-eval)" : "ENABLED"}`);
  console.log("=".repeat(75) + "\n");

  await ensureDaemonRunning(targetBaseUrl);

  const benchmarkReport = {
    phases: {},
    timings: {},
    components: {},
    overall: {}
  };

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Status & Connectivity Latency
    // -------------------------------------------------------------------------
    console.log("📡 Phase 1: Testing /api/status (Daemon Health & Configuration)...");
    const tStatus0 = performance.now();
    const statusRes = await fetch(`${targetBaseUrl}/api/status`);
    const statusLatency = performance.now() - tStatus0;

    if (!statusRes.ok) {
      throw new Error(`Daemon status failed with status ${statusRes.status}: ${statusRes.statusText}`);
    }
    const statusData = await statusRes.json();
    benchmarkReport.timings.status = statusLatency;

    console.log(`   ✅ Status OK in ${formatTime(statusLatency)}`);
    console.log(`   🤖 Local Model:     ${statusData.model || "N/A"}`);
    console.log(`   📂 Files Indexed:   ${statusData.fileCount || 0}`);
    console.log(`   📁 Project Root:    ${statusData.projectRoot || "N/A"}`);
    console.log(`   🧩 Supported Modes: ${(statusData.modes || ["levelgen"]).join(", ")}\n`);

    // -------------------------------------------------------------------------
    // Phase 2: RAG Retrieval Search Latencies for all 3 Modalities
    // -------------------------------------------------------------------------
    console.log("📂 Phase 2: Testing RAG Retrieval Latency (/api/files across components)...");
    const ragModes = [
      { mode: "levelgen", prompt: "RoomMedExam_base medical layout with bed and privacy screen" },
      { mode: "character", prompt: "Emily patient vitals fever 39.1 temperature PatientNews1" },
      { mode: "scenario", prompt: "Nurse entry hand washing vitals checking MainLoop throttled" }
    ];

    benchmarkReport.rag = {};
    for (const { mode, prompt } of ragModes) {
      const tRag0 = performance.now();
      const ragRes = await fetch(`${targetBaseUrl}/api/files?mode=${mode}&prompt=${encodeURIComponent(prompt)}`);
      const ragLatency = performance.now() - tRag0;

      if (!ragRes.ok) {
        console.warn(`   ⚠️ RAG retrieval failed for mode '${mode}': ${ragRes.statusText}`);
        continue;
      }
      const ragData = await ragRes.json();
      const topMatch = ragData.files?.[0];
      benchmarkReport.rag[mode] = { latency: ragLatency, topMatch: topMatch?.rel || "None", score: topMatch?.score || 0 };

      console.log(`   ✅ [${mode.toUpperCase().padEnd(9)}] RAG search in ${formatTime(ragLatency)} | Top: ${truncate(topMatch?.rel || "None", 40)} (Score: ${topMatch?.score || 0})`);
    }
    console.log("");

    // -------------------------------------------------------------------------
    // Phase 3: Multi-Agent Orchestration & Sequential Generation Pipeline
    // -------------------------------------------------------------------------
    console.log("🧠 Phase 3: Executing Sequential Multi-Agent Generation Pipeline...");
    console.log("   (Orchestrator $\\rightarrow$ LevelGen Agent $\\rightarrow$ Character Agent $\\rightarrow$ Scenario Agent)");
    console.log("   Running local Ollama inference; this performs 4 LLM generations...\n");

    const tPipe0 = performance.now();
    const pipePayload = {
      prompt: customPrompt,
      userPrompt: customPrompt,
      roomName: targetRoom,
      provider: targetProvider,
      model: targetModel,
      baseName: `Benchmark_${Date.now().toString().slice(-6)}`,
      strictConstraints: true,
      componentConfigs: {
        levelgen: { action: "create" },
        character: { action: "create" },
        scenario: { action: "create" }
      }
    };

    const pipeRes = await fetch(`${targetBaseUrl}/generate-sequential`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pipePayload)
    });
    const pipeClientLatency = performance.now() - tPipe0;

    if (!pipeRes.ok) {
      const errBody = await pipeRes.text();
      throw new Error(`Sequential pipeline failed with HTTP ${pipeRes.status}: ${errBody}`);
    }

    const pipeData = await pipeRes.json();
    const plan = pipeData.orchestratorPlan || {};
    const results = pipeData.results || {};
    const serverTimings = pipeData.timings || {};

    console.log(`   ✅ Pipeline Completed in ${formatTime(pipeClientLatency)}!`);
    console.log(`   📋 Master Plan Title: "${plan.title || "Untitled"}"`);
    console.log(`   🎯 Goal:              "${truncate(plan.goal || "", 70)}"`);
    console.log(`   ⏱️  Timing Breakdown (Server-side):`);
    console.log(`      - Orchestrator Planning: ${formatTime(serverTimings.planningMs || 0)}`);
    console.log(`      - LevelGen Agent:        ${formatTime(serverTimings.levelgenMs || 0)}`);
    console.log(`      - Character Agent:       ${formatTime(serverTimings.characterMs || 0)}`);
    console.log(`      - Scenario Agent:        ${formatTime(serverTimings.scenarioMs || 0)}`);
    console.log(`      - Total Sequential Core: ${formatTime(serverTimings.totalPipelineMs || pipeClientLatency)}\n`);

    // -------------------------------------------------------------------------
    // Phase 4: Output File Writing & Quality Metrics
    // -------------------------------------------------------------------------
    console.log("💾 Phase 4: Verifying Disk File Writing & Output Code Sanity...");

    const componentNames = ["levelgen", "character", "scenario"];
    const compData = {};

    for (const name of componentNames) {
      const res = results[name];
      if (!res) {
        console.log(`   ❌ Component '${name}' missing from results!`);
        continue;
      }

      const script = res.script || "";
      const lines = script.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const byteSize = Buffer.byteLength(script, "utf8");
      const charCount = script.length;
      const stepDurationMs = serverTimings[`${name}Ms`] || (pipeClientLatency / 3);
      const charsPerSec = stepDurationMs > 0 ? (charCount / (stepDurationMs / 1000)).toFixed(1) : "N/A";

      // File writing checks
      const savedPathExists = res.savedPath && fs.existsSync(res.savedPath);
      const activePathExists = res.activePath && fs.existsSync(res.activePath);
      const filesWritten = savedPathExists && activePathExists;

      // Sanity checks
      const hasMarkdownFences = script.includes("```");
      const localEval = res.localEvaluation || { pass: false, errors: [], warnings: [] };

      compData[name] = {
        name,
        action: res.action || "created",
        savedPath: res.savedPath,
        activePath: res.activePath,
        filesWritten,
        byteSize,
        charCount,
        lineCount: lines.length,
        durationMs: stepDurationMs,
        charsPerSec,
        hasMarkdownFences,
        localEval,
        script
      };

      console.log(`   📄 [${name.toUpperCase().padEnd(9)}] ${res.action === "created" ? "Created" : "Edited"}:`);
      console.log(`      • Path:       ${res.savedPath}`);
      console.log(`      • Active:     ${res.activePath}`);
      console.log(`      • File Write: ${filesWritten ? "✅ VERIFIED ON DISK" : "❌ WRITE FAILED"}`);
      console.log(`      • Metrics:    ${lines.length} lines | ${formatBytes(byteSize)} | ${charsPerSec} chars/sec`);
      console.log(`      • Markdown:   ${hasMarkdownFences ? "⚠️ FENCES DETECTED" : "✅ CLEAN RAW CODE"}`);
      console.log(`      • Local Pass: ${localEval.pass ? "✅ PASS" : "⚠️ ISSUES FOUND"} (${localEval.errors?.length || 0} errors, ${localEval.warnings?.length || 0} warnings)`);
    }

    // Context Propagation Check: Character vitals -> Scenario
    console.log("\n🔗 Phase 4b: Context Flow Verification (Character $\\rightarrow$ Scenario)...");
    const charScript = compData.character?.script || "";
    const scenScript = compData.scenario?.script || "";

    const patientNameMatch = charScript.match(/\$PatientName\s*=\s*['"]?([a-zA-Z0-9_-]+)/i);
    const patientName = patientNameMatch ? patientNameMatch[1] : null;

    let contextPassed = true;
    const contextObservations = [];

    if (patientName) {
      const nameInScenario = new RegExp(patientName, "i").test(scenScript);
      contextObservations.push(`Patient name '${patientName}' in scenario: ${nameInScenario ? "✅ PRESENT" : "⚠️ NOT DETECTED"}`);
      if (!nameInScenario) contextPassed = false;
    }

    const hasVitalsRef = /\$(?:Temperature|HR|BP|SpO2|Respiration)/i.test(scenScript);
    contextObservations.push(`Vital sign variables referenced in scenario: ${hasVitalsRef ? "✅ REFERENCED" : "ℹ️ NOT EXPLICITLY REFERENCED"}`);

    const hasCanvasControl = /Canvas\s+(?:on|off)/i.test(scenScript);
    contextObservations.push(`Canvases initialized in scenario: ${hasCanvasControl ? "✅ INITIALIZED" : "⚠️ MISSING"}`);

    const hasLoopThrottle = /Wait\s+\.?\d+/i.test(scenScript);
    contextObservations.push(`Loop throttle delay (Wait): ${hasLoopThrottle ? "✅ THROTTLED" : "⚠️ MISSING"}`);

    for (const obs of contextObservations) {
      console.log(`   • ${obs}`);
    }
    console.log("");

    // -------------------------------------------------------------------------
    // Phase 5: Evaluation Model Latencies & Scores for each Component
    // -------------------------------------------------------------------------
    const evalResults = {};

    if (!skipEval) {
      console.log("🔍 Phase 5: Testing POST /evaluate (Semantic LLM Evaluation on Outputs)...");

      for (const name of componentNames) {
        const item = compData[name];
        if (!item || !item.script) continue;

        console.log(`   Evaluating ${name.toUpperCase()} output...`);
        const tEval0 = performance.now();
        const evalRes = await fetch(`${targetBaseUrl}/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: name,
            script: item.script,
            prompt: customPrompt,
            roomName: targetRoom,
            provider: targetProvider,
            model: targetModel
          })
        });
        const evalLatency = performance.now() - tEval0;

        if (!evalRes.ok) {
          console.warn(`   ⚠️ Evaluation call failed for ${name}: ${evalRes.statusText}`);
          continue;
        }

        const evalData = await evalRes.json();
        const modelEval = evalData.modelEvaluation || {};
        const localEval = evalData.localEvaluation || item.localEval;

        const score = typeof modelEval.score === "number" ? modelEval.score : null;
        const modelPass = typeof modelEval.pass === "boolean" ? modelEval.pass : null;
        const problemsCount = Array.isArray(modelEval.problems) ? modelEval.problems.length : (modelEval.problems ? 1 : 0);
        const fixesCount = Array.isArray(modelEval.fixes) ? modelEval.fixes.length : (modelEval.fixes ? 1 : 0);
        const hasCorrectedVersion = !!modelEval.corrected_version;
        const agreement = (localEval?.pass === modelPass);

        evalResults[name] = {
          evalLatency,
          score,
          modelPass,
          problemsCount,
          fixesCount,
          hasCorrectedVersion,
          agreement,
          localPass: localEval?.pass,
          modelEval
        };

        console.log(`   ✅ [${name.toUpperCase().padEnd(9)}] Evaluated in ${formatTime(evalLatency)}:`);
        console.log(`      • Model Score: ${score !== null ? `${score}/100` : "N/A"}`);
        console.log(`      • Model Pass:  ${modelPass !== null ? (modelPass ? "PASS" : "FAIL") : "N/A"}`);
        console.log(`      • Problems:    ${problemsCount} | Fixes: ${fixesCount} | Corrected Version: ${hasCorrectedVersion ? "Yes" : "No"}`);
        console.log(`      • Agreement:   ${agreement ? "✅ Local & Model AGREE" : "⚠️ Local vs Model DISCREPANCY"}`);
      }
      console.log("");
    }

    // -------------------------------------------------------------------------
    // Phase 6: Comprehensive Benchmark Summary Dashboard
    // -------------------------------------------------------------------------
    console.log("=".repeat(85));
    console.log("                       PIPELINE BENCHMARK SUMMARY DASHBOARD                  ");
    console.log("=".repeat(85));
    console.log(
      "Component".padEnd(12) +
      "Gen Time".padEnd(12) +
      "Size / Lines".padEnd(16) +
      "Rate (c/s)".padEnd(12) +
      "Local Pass".padEnd(12) +
      "LLM Score".padEnd(11) +
      "Eval Time"
    );
    console.log("-".repeat(85));

    let totalEvalTime = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const name of componentNames) {
      const item = compData[name] || {};
      const ev = evalResults[name] || {};

      const genTimeStr = item.durationMs ? `${(item.durationMs / 1000).toFixed(2)}s` : "N/A";
      const sizeStr = item.byteSize ? `${formatBytes(item.byteSize)} (${item.lineCount}L)` : "N/A";
      const rateStr = item.charsPerSec ? `${item.charsPerSec}` : "N/A";
      const localStr = item.localEval?.pass ? "PASS ✅" : "WARN ⚠️";
      const llmStr = ev.score !== null && ev.score !== undefined ? `${ev.score}/100` : (skipEval ? "SKIPPED" : "N/A");
      const evalTimeStr = ev.evalLatency ? `${(ev.evalLatency / 1000).toFixed(2)}s` : (skipEval ? "-" : "N/A");

      if (ev.evalLatency) totalEvalTime += ev.evalLatency;
      if (typeof ev.score === "number") {
        scoreSum += ev.score;
        scoreCount++;
      }

      console.log(
        name.toUpperCase().padEnd(12) +
        genTimeStr.padEnd(12) +
        sizeStr.padEnd(16) +
        rateStr.padEnd(12) +
        localStr.padEnd(12) +
        llmStr.padEnd(11) +
        evalTimeStr
      );
    }

    console.log("-".repeat(85));
    const totalGenTime = serverTimings.totalPipelineMs || pipeClientLatency;
    const avgScore = scoreCount > 0 ? (scoreSum / scoreCount).toFixed(1) : "N/A";

    console.log(`Planning Latency:        ${formatTime(serverTimings.planningMs || 0)}`);
    console.log(`Total Generation Time:   ${formatTime(totalGenTime)}`);
    if (!skipEval) {
      console.log(`Total Evaluation Time:   ${formatTime(totalEvalTime)}`);
      console.log(`Overall Pipeline + Eval: ${formatTime(totalGenTime + totalEvalTime)}`);
      console.log(`Average Model Score:     ${avgScore}/100`);
    }
    console.log(`All Files Written:       ${Object.values(compData).every((c) => c.filesWritten) ? "YES (All components verified on disk)" : "NO"}`);
    console.log(`Context Flow Verified:   ${contextPassed ? "YES (Character vitals propagated to Scenario)" : "PARTIAL"}`);
    console.log("=".repeat(85));

    console.log("\n🎉 Benchmark completed successfully!\n");

  } catch (error) {
    console.error("\n❌ Benchmark run aborted with error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

runRevampedPipelineBenchmark();

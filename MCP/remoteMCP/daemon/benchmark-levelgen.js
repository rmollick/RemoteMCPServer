import "dotenv/config";

const PORT = Number(process.env.PORT || 3333);
const BASE_URL = `http://localhost:${PORT}`;

async function runLevelGenBenchmark() {
  console.log(`\n🚀 Starting LevelGen MCP Benchmark against daemon at ${BASE_URL}\n`);

  try {
    // 1. Benchmark GET /api/status
    console.log("📡 Step 1: Testing /api/status...");
    const t0 = performance.now();
    const statusRes = await fetch(`${BASE_URL}/api/status`);
    const statusTime = performance.now() - t0;

    if (!statusRes.ok) {
      throw new Error(`Status failed: ${statusRes.statusText}`);
    }
    const statusData = await statusRes.json();
    console.log(`✅ Status checked in ${statusTime.toFixed(1)}ms`);
    console.log(`   Model: ${statusData.model}`);
    console.log(`   Files Indexed: ${statusData.fileCount}`);
    console.log(`   Project Root: ${statusData.projectRoot}\n`);

    // 2. Benchmark GET /api/files (RAG retrieval step)
    console.log("📂 Step 2: Testing /api/files (RAG Search latency)...");
    const testPrompt = "Generate a complex medical exam room LevelGen file based on the corrected/manual examples.";
    const t1 = performance.now();
    const filesRes = await fetch(`${BASE_URL}/api/files?mode=levelgen&prompt=${encodeURIComponent(testPrompt)}`);
    const filesTime = performance.now() - t1;

    if (!filesRes.ok) {
      throw new Error(`File indexing failed: ${filesRes.statusText}`);
    }
    const filesData = await filesRes.json();
    console.log(`✅ File index search completed in ${filesTime.toFixed(1)}ms`);
    console.log(`   Found ${filesData.files.length} candidate files.`);
    console.log(`   Top match: ${filesData.files[0]?.rel || "None"} (Score: ${filesData.files[0]?.score || 0})\n`);

    // 3. Benchmark POST /generate (LLM generation step)
    console.log("🧠 Step 3: Testing POST /generate (LLM generation latency)...");
    console.log("   (This runs Ollama locally, which can take several seconds...)");

    // Construct multipart form data
    const formData = new FormData();
    formData.append("mode", "levelgen");
    formData.append("fileName", "Benchmark_MedRoom_AI");
    formData.append("prompt", testPrompt);
    formData.append("topK", "12");
    formData.append("selectedPaths", JSON.stringify([]));

    const t2 = performance.now();
    const genRes = await fetch(`${BASE_URL}/generate`, {
      method: "POST",
      body: formData,
    });
    const genTime = performance.now() - t2;

    if (!genRes.ok) {
      throw new Error(`Generation failed: ${genRes.statusText}`);
    }
    const genData = await genRes.json();
    console.log(`✅ Generation completed in ${(genTime / 1000).toFixed(2)}s (${genTime.toFixed(1)}ms)`);
    console.log(`   Model used: ${genData.model}`);
    console.log(`   Saved path: ${genData.savedPath}`);
    console.log(`   Active path: ${genData.activePath}`);
    console.log(`   Local check passed: ${genData.localEvaluation.pass ? "Yes" : "No"}`);
    if (genData.localEvaluation.warnings.length > 0) {
      console.log(`   Warnings: ${genData.localEvaluation.warnings.length}`);
    }
    console.log(`   Generated script preview:\n------------------\n${genData.script.slice(0, 300)}...\n------------------\n`);

    // 4. Benchmark POST /evaluate
    console.log("🔍 Step 4: Testing POST /evaluate (LLM Evaluation latency)...");
    const evalPayload = {
      mode: "levelgen",
      script: genData.script,
      prompt: testPrompt
    };

    const t3 = performance.now();
    const evalRes = await fetch(`${BASE_URL}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(evalPayload),
    });
    const evalTime = performance.now() - t3;

    if (!evalRes.ok) {
      throw new Error(`Evaluation failed: ${evalRes.statusText}`);
    }
    const evalData = await evalRes.json();

    // Extract evaluation metrics
    const modelEval = evalData.modelEvaluation || {};

    // Debugging print in case it is returning N/A
    if (!modelEval.score && !modelEval.pass) {
      console.log("⚠️  Warning: Model returned empty or unparsed evaluation structure. Raw response was:");
      console.log(JSON.stringify(modelEval, null, 2));
    }

    const hasValidSchema = typeof modelEval.score !== 'undefined' && typeof modelEval.pass !== 'undefined';

    const problemsCount = Array.isArray(modelEval.problems) ? modelEval.problems.length : (modelEval.problems ? 1 : 0);
    const fixesCount = Array.isArray(modelEval.fixes) ? modelEval.fixes.length : (modelEval.fixes ? 1 : 0);
    const hasCorrectedVersion = !!modelEval.corrected_version;

    const localPass = evalData.localEvaluation?.pass;
    const modelPass = modelEval.pass;
    const evaluationAgreement = localPass === modelPass;

    console.log(`✅ Evaluation completed in ${(evalTime / 1000).toFixed(2)}s (${evalTime.toFixed(1)}ms)`);
    console.log(`   Model Score:           ${modelEval.score ?? "N/A"}/100`);
    console.log(`   Model Pass:            ${modelEval.pass ?? "N/A"}`);
    console.log(`   Format Schema Valid:   ${hasValidSchema ? "Yes" : "No"}`);
    console.log(`   Problems Identified:   ${problemsCount}`);
    console.log(`   Fixes Suggested:       ${fixesCount}`);
    console.log(`   Corrected Script:      ${hasCorrectedVersion ? "Generated" : "Missing"}`);
    console.log(`   Agreement with Local:  ${evaluationAgreement ? "Yes (Both " + (localPass ? "Passed" : "Failed") + ")" : "No (Discrepancy)"}\n`);

    // PRINT SUMMARY
    console.log("==========================================");
    console.log("        LEVELGEN ENDPOINT METRICS         ");
    console.log("==========================================");
    console.log(`1. Status Latency:     ${statusTime.toFixed(1)} ms`);
    console.log(`2. RAG Search:         ${filesTime.toFixed(1)} ms`);
    console.log(`3. Generation:         ${(genTime / 1000).toFixed(2)} s`);
    console.log(`4. Evaluation:         ${(evalTime / 1000).toFixed(2)} s`);
    console.log("------------------------------------------");
    console.log(`Total Pipeline Time:   ${((statusTime + filesTime + genTime + evalTime) / 1000).toFixed(2)} s`);
    console.log(`Eval/Gen Time Ratio:   ${(evalTime / genTime).toFixed(2)}x`);
    console.log("------------------------------------------");
    console.log("          EVALUATION ANALYSIS            ");
    console.log("------------------------------------------");
    console.log(`Evaluation Format Check:  ${hasValidSchema ? "PASS" : "FAIL"}`);
    console.log(`Syntax vs. Semantic Agree: ${evaluationAgreement ? "AGREE" : "DISAGREE"}`);
    console.log(`Detected Bugs/Warnings:   Local: ${evalData.localEvaluation?.errors?.length || 0} | Model: ${problemsCount}`);
    console.log("==========================================\n");

  } catch (error) {
    console.error("\n❌ Benchmark failed with error:", error.message);
  }
}

runLevelGenBenchmark();

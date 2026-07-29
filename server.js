const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require('dotenv').config();


const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.LOCAL_MODEL;

const PROJECT_ROOT =
  process.env.CEREBRUM_PROJECT_ROOT ||
  "C:\\CerebrumProjectSasan-main\\CerebrumProjectSasan-main";

const STREAMING_ASSETS_DIR = path.join(PROJECT_ROOT, "Assets", "StreamingAssets");
const SCENARIOS_DIR = path.join(STREAMING_ASSETS_DIR, "Scenarios");
const LEVELGEN_DIR = path.join(STREAMING_ASSETS_DIR, "LevelGen");
const LOCAL_MANUAL_DIR = path.join(__dirname, "manual-levelgen-examples");
const LOCAL_CORRECTED_DIR = path.join(__dirname, "corrected-levelgen-examples");
const MEMORY_PATH = path.join(__dirname, "Workspace Memory.txt");

const MAX_FILE_CHARS = 9000;
const MAX_CONTEXT_CHARS = 42000;
const DEFAULT_TOP_K = 12;
const READABLE_EXTENSIONS = new Set([
  ".txt",
  ".csv",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".md",
  ".ini",
  ".cfg"
]);
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* ws://localhost:*; frame-src 'self' http://localhost:*;"
  );
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function walkFiles(dir, bucket = []) {
  if (!exists(dir)) return bucket;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "Library", "Temp", "Obj", "Build"].includes(entry.name)) continue;
      walkFiles(fullPath, bucket);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (READABLE_EXTENSIONS.has(ext) && !entry.name.endsWith(".meta")) {
        bucket.push(fullPath);
      }
    }
  }
  return bucket;
}

function readTextSafe(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2_000_000) return "";
    return fs.readFileSync(filePath, "utf8").slice(0, MAX_FILE_CHARS);
  } catch {
    return "";
  }
}

function projectRelative(filePath) {
  if (filePath.startsWith(PROJECT_ROOT)) return path.relative(PROJECT_ROOT, filePath);
  return path.relative(__dirname, filePath);
}

function getAllKnowledgeFiles() {
  const files = [];
  files.push(...walkFiles(STREAMING_ASSETS_DIR));
  files.push(...walkFiles(LOCAL_MANUAL_DIR));
  files.push(...walkFiles(LOCAL_CORRECTED_DIR));
  return [...new Set(files)].map((filePath) => {
    const text = readTextSafe(filePath);
    const rel = projectRelative(filePath);
    const priority = filePath.includes("corrected-levelgen-examples")
      ? 1000
      : filePath.includes("manual-levelgen-examples")
        ? 800
        : rel.toLowerCase().includes("levelgen")
          ? 300
          : rel.toLowerCase().includes("scenario")
            ? 200
            : 100;
    return {
      path: filePath,
      rel,
      size: text.length,
      priority,
      text
    };
  }).filter((f) => f.text.trim().length > 0);
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\/\\.-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function scoreFile(file, prompt, mode) {
  const hay = (file.rel + "\n" + file.text).toLowerCase();
  const words = tokenize(prompt);
  let score = file.priority;
  for (const word of words) {
    if (hay.includes(word)) score += 20;
  }
  const rel = file.rel.toLowerCase();
  if (mode === "levelgen" && rel.includes("levelgen")) score += 500;
  if (mode === "levelgen" && rel.includes("corrected")) score += 1000;
  if (mode === "scenario" && rel.includes("scenario")) score += 500;
  if (mode === "scenario" && file.text.includes("Do '")) score += 250;
  return score;
}

function buildContext({ prompt, mode, selectedPaths = [], topK = DEFAULT_TOP_K }) {
  const memory = exists(MEMORY_PATH) ? readTextSafe(MEMORY_PATH) : "";
  const all = getAllKnowledgeFiles();
  const selectedSet = new Set(selectedPaths || []);
  const selected = all.filter((f) => selectedSet.has(f.path) || selectedSet.has(f.rel));
  const ranked = all
    .filter((f) => !selected.includes(f))
    .map((f) => ({ ...f, score: scoreFile(f, prompt, mode) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(topK) || DEFAULT_TOP_K);

  const finalFiles = [...selected, ...ranked];
  let context = `WORKSPACE MEMORY:\n${memory}\n\nREFERENCE FILES START\n`;
  for (const f of finalFiles) {
    const block = `\n--- FILE: ${f.rel} ---\n${f.text}\n`;
    if ((context + block).length > MAX_CONTEXT_CHARS) break;
    context += block;
  }
  context += "\nREFERENCE FILES END\n";
  return { context, files: finalFiles.map(({ rel, path, size, priority, score }) => ({ rel, path, size, priority, score })) };
}

function cleanGenerated(text) {
  return (text || "")
    .replace(/```txt/gi, "")
    .replace(/```cerebrum/gi, "")
    .replace(/```/g, "")
    .replace(/^Here is.*$/gim, "")
    .replace(/^Sure[,!]?.*$/gim, "")
    .trim();
}

function safeFileName(name) {
  const cleaned = (name || "GeneratedFile")
    .replace(/[^a-z0-9_\- ]/gi, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned || "GeneratedFile";
}

function getOutputDir(mode) {
  if (mode === "levelgen") return process.env.LEVELGEN_OUTPUT_DIR || path.join(LEVELGEN_DIR, "Generated");
  return process.env.SCENARIO_OUTPUT_DIR || path.join(SCENARIOS_DIR, "Generated");
}

function localEvaluate(script, mode) {
  const errors = [];
  const warnings = [];
  const lines = script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!script.trim()) errors.push("Generated file is empty.");
  if (script.includes("```")) errors.push("Generated file still contains markdown code fences.");

  if (mode === "scenario") {
    const validStarts = ["Do '", "Prompt '", "Wait ", "Return", "Label '", "Goto '", "If ", "Else", "Endif", "$", "//", "#"];
    for (const line of lines) {
      if (!validStarts.some((prefix) => line.startsWith(prefix))) {
        warnings.push(`Unusual scenario line: ${line}`);
      }
    }
    if (!lines.some((l) => l.startsWith("Do '"))) warnings.push("No Do statements found. Actual Unity actions may not happen.");
    if (!lines[lines.length - 1]?.startsWith("Return")) warnings.push("Script does not end with Return.");
  }

  if (mode === "levelgen") {
    if (!lines.some((l) => l.toLowerCase().startsWith("room"))) errors.push("No Room line found.");
    for (const line of lines) {
      if (line.startsWith("#") || line.startsWith("//")) continue;
      const parts = line.split(/\t+| {2,}/).filter(Boolean);
      if (parts.length < 3) warnings.push(`Possible short LevelGen row: ${line}`);
    }
  }
  return { pass: errors.length === 0, errors, warnings };
}

async function callOllama(body) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama failed: ${errorText}`);
  }
  return response.json();
}

app.get("/api/status", (req, res) => {
  const files = getAllKnowledgeFiles();
  res.json({
    projectRoot: PROJECT_ROOT,
    streamingAssetsDir: STREAMING_ASSETS_DIR,
    scenariosDir: SCENARIOS_DIR,
    levelgenDir: LEVELGEN_DIR,
    localManualDir: LOCAL_MANUAL_DIR,
    localCorrectedDir: LOCAL_CORRECTED_DIR,
    model: OLLAMA_MODEL,
    ollamaUrl: OLLAMA_URL,
    fileCount: files.length,
    sampleFiles: files.slice(0, 30).map((f) => ({ rel: f.rel, path: f.path, size: f.size }))
  });
});

app.get("/api/files", (req, res) => {
  const mode = req.query.mode || "scenario";
  const prompt = req.query.prompt || "";
  const files = getAllKnowledgeFiles()
    .map((f) => ({ ...f, score: scoreFile(f, prompt, mode) }))
    .sort((a, b) => b.score - a.score)
    .map(({ rel, path, size, priority, score }) => ({ rel, path, size, priority, score }));
  res.json({ files });
});

app.post("/generate", upload.single("image"), async (req, res) => {
  try {
    const mode = req.body.mode || "scenario";
    const userPrompt = req.body.prompt || "";
    const fileName = safeFileName(req.body.fileName || (mode === "levelgen" ? "GeneratedLevel" : "GeneratedScenario"));
    const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
    const topK = Number(req.body.topK || DEFAULT_TOP_K);

    if (!userPrompt.trim()) return res.status(400).json({ error: "Prompt is required." });

    const { context, files } = buildContext({ prompt: userPrompt, mode, selectedPaths, topK });
    const outputRules = mode === "levelgen"
      ? `Generate a LevelGen room file. Output only raw LevelGen rows. Use tab-separated columns when possible. Start with a Room row. Mimic corrected examples first.`
      : `Generate a Cerebrum scenario .txt file. Output only raw script lines. Use Do statements for real actions and Prompt only for visible dialogue.`;

    const prompt = `
You are connected to a local Unity/Cerebrum project.
You must generate files based on the reference project files below.

${context}

TASK MODE: ${mode}
USER REQUEST:
${userPrompt}

OUTPUT RULES:
${outputRules}
Do not explain.
Do not use markdown.
Do not invent a different file format.
If unsure, copy the structure from the most relevant corrected/manual examples.
`;

    const ollamaBody = {
      model: OLLAMA_MODEL,
      prompt,
      stream: false
    };
    if (req.file) ollamaBody.images = [req.file.buffer.toString("base64")];

    const data = await callOllama(ollamaBody);
    const script = cleanGenerated(data.response || "");
    const outputDir = getOutputDir(mode);
    fs.mkdirSync(outputDir, { recursive: true });

    const savedPath = path.join(outputDir, `${fileName}.txt`);
    const activePath = path.join(outputDir, mode === "levelgen" ? "ActiveGeneratedLevelGen.txt" : "ActiveGeneratedScenario.txt");
    fs.writeFileSync(savedPath, script, "utf8");
    fs.writeFileSync(activePath, script, "utf8");

    res.json({
      script,
      savedPath,
      activePath,
      mode,
      model: OLLAMA_MODEL,
      usedFiles: files,
      localEvaluation: localEvaluate(script, mode)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error.", details: err.message });
  }
});

app.post("/evaluate", async (req, res) => {
  try {
    const mode = req.body.mode || "scenario";
    const script = req.body.script || "";
    const prompt = req.body.prompt || "Evaluate this generated file.";
    const { context, files } = buildContext({ prompt, mode, selectedPaths: [], topK: 8 });
    const local = localEvaluate(script, mode);
    const evalPrompt = `
Evaluate this generated ${mode} file against the project examples.
Return JSON only with keys: score, pass, problems, fixes, corrected_version.

${context}

GENERATED FILE:
${script}

LOCAL CHECK RESULTS:
${JSON.stringify(local, null, 2)}
`;
    const data = await callOllama({
      model: OLLAMA_MODEL,
      prompt: evalPrompt,
      stream: false,
      format: "json"
    });
    let modelEvaluation;
    try {
      modelEvaluation = JSON.parse(data.response || "{}");
    } catch {
      modelEvaluation = { raw: data.response };
    }
    res.json({ localEvaluation: local, modelEvaluation, usedFiles: files });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Evaluation error.", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cerebrum Ollama RAG + LevelGen server running at http://localhost:${PORT}`);
  console.log(`Using model: ${OLLAMA_MODEL}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Reading from: ${STREAMING_ASSETS_DIR}`);
  console.log(`Scenario output: ${getOutputDir("scenario")}`);
  console.log(`LevelGen output: ${getOutputDir("levelgen")}`);
});

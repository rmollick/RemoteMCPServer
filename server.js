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
  const memoryPath = mode === "scenario"
    ? path.join(path.dirname(MEMORY_PATH), "Workspace Memory Scenario.txt")
    : MEMORY_PATH;
  const memory = exists(memoryPath) ? readTextSafe(memoryPath) : "";
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

  if (mode === "scenario") {
    const levelgenOutputDir = getOutputDir("levelgen");
    const activeLevelGenPath = path.join(levelgenOutputDir, "ActiveGeneratedLevelGen.txt");
    if (exists(activeLevelGenPath)) {
      const activeText = readTextSafe(activeLevelGenPath);
      if (activeText.trim()) {
        context = `GENERATED LEVELGEN LAYOUT (YOU MUST MATCH THIS EXACT LAYOUT):\n${activeText}\n\n${context}`;
      }
    }
  }

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
  if (mode === "character") return process.env.CHARACTER_OUTPUT_DIR || path.join(SCENARIOS_DIR, "Generated", "Character");
  return process.env.SCENARIO_OUTPUT_DIR || path.join(SCENARIOS_DIR, "Generated");
}

function activeFileName(mode) {
  if (mode === "levelgen") return "ActiveGeneratedLevelGen.txt";
  if (mode === "character") return "ActiveGeneratedCharacter.txt";
  return "ActiveGeneratedScenario.txt";
}

function resolveSafeFilePath(inputPath, defaultDir) {
  if (!inputPath) return null;
  const raw = String(inputPath).trim();
  if (path.isAbsolute(raw)) {
    return path.normalize(raw);
  }
  return path.resolve(defaultDir || PROJECT_ROOT, raw);
}

function outputRulesForMode(mode, roomName = "RoomMedExam_base") {
  if (mode === "levelgen") {
    return `Generate a LevelGen room file. Output only raw tab-separated LevelGen rows. The first row must be Room\t0\t${roomName}. Use only valid room slots, parent prefabs, child slots, and child prefabs from the workspace constraints. Never invent unsupported objects or slots.`;
  }
  if (mode === "character") {
    return "Generate a Cerebrum scenario script (.txt) for patient/character setup and styling. Output only raw script lines following the Cerebrum Scripting Guide. Initialize patient variables (e.g., $PatientName = '...', $PatientAge = 87, $Temperature = 36.5, $HR = 70, $BP = '150/71', $Respiration = 20, $SpO2 = 100, $PatientSpeak = '...') and call styling/appearance Do scripts (e.g., Do 'NEWS_Nurse/PatientCreations/Age/75' or Do $Patient SetHairColor Dark) referencing the bed location and patient reference variables. Do not generate LevelGen room layout rows or unrelated scenario clinical actions.";
  }
  return "Generate a Cerebrum scenario .txt file. Output only raw script lines. Use Do statements for real actions and Prompt only for visible dialogue. Do not generate LevelGen rows or character appearance configuration unless the scenario syntax requires a patient reference.";
}

function buildSequentialTasks(userPrompt) {
  return {
    title: "Sequential Simulation Plan",
    goal: "Fulfill the user request sequentially",
    levelgen_task: `Generate the physical room/environment setup only. Do not write scenario behavior or detailed character appearance. Overall request:\n${userPrompt}`,
    character_task: `Generate the patient/character setup and appearance customization only. Do not generate LevelGen rows or scenario behavior. Overall request:\n${userPrompt}`,
    scenario_task: `Generate scenario clinical flow and logic only. Do not generate LevelGen layout or character appearance. Overall request:\n${userPrompt}`
  };
}

async function runOrchestrator(userPrompt, roomName, componentConfigs = {}) {
  let targetDetails = "";
  if (componentConfigs?.levelgen?.action === "edit") {
    targetDetails += `\n- LevelGen Component: EDIT existing file (${componentConfigs.levelgen.targetPath || "selected layout"}).`;
  }
  if (componentConfigs?.character?.action === "edit") {
    targetDetails += `\n- Character Component: EDIT existing file (${componentConfigs.character.targetPath || "selected character"}).`;
  }
  if (componentConfigs?.scenario?.action === "edit") {
    targetDetails += `\n- Scenario Component: EDIT existing file (${componentConfigs.scenario.targetPath || "selected scenario"}).`;
  }

  const prompt = `
You are the Manager/Orchestrator Agent for a Unity Cerebrum simulation creation pipeline.
Your job is to read the user request and generate a single unified Master Simulation Plan.
This plan must outline the overall goals, and divide the requirements into a list of clear, structured tasks for 3 specialized sub-agents:
1. LevelGen Agent ("levelgen_task"): For generating or modifying the physical environment and layout (specifying Room, Location, child items matching available slots and hard constraints).
   CRITICAL CONSTRAINT FOR RoomMedExam_base: RoomMedExam_base ONLY supports: Bed (1, 2, 3), Wall (1, 2, 3), BedsideHead (1, 2), BedsideMid (1, 2), BedsideFoot (1, 2), Cart (1, 2), and Screen (1, 2, 3, 4).
   NEVER ask to place a Nurse, Nurse Station, Doctor, Chair, Desk, Bin, Cabinet, or BedsideHeadLeft in RoomMedExam_base. Physical layouts do not contain actor characters; character placement and actions are handled purely in character/scenario scripts.
2. Character Agent ("character_task"): For creating or modifying the character/patient setup script, setting patient name, age, vitals variables ($Temperature, $HR, $BP, $Respiration, $SpO2), character dialogue ($PatientSpeak), and styling appearance Do calls (e.g. SetHairColor, SetHairStyle, setblend, rigs) following the Cerebrum Scripting Guide.
3. Scenario Agent ("scenario_task"): For scripting clinical workflow logic (using Do statements for actions/dialogue, Prompt statements, Wait statements, conditionals, choices, and ending with Return).

${roomName ? `Target Room: ${roomName}` : ""}
${targetDetails ? `COMPONENT SPECIFICATIONS:${targetDetails}` : ""}

OVERALL USER REQUEST:
${userPrompt}

You MUST return a JSON object with this exact schema:
{
  "title": "A short descriptive title for the Master Plan",
  "goal": "Overview of what this simulation accomplishes",
  "levelgen_task": "Detailed, specific tasks for the physical level setup...",
  "character_task": "Detailed, specific tasks for setting patient details, vitals variables, speech, and look styling...",
  "scenario_task": "Detailed, specific tasks for the scenario clinical flow, actions, prompts, and conditions..."
}
Do not return any explanations, note blocks, or markdown code fences (like \`\`\`json). Just the raw JSON.
`;

  try {
    const data = await callOllama({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: "json"
    });
    const text = cleanGenerated(data.response || "{}");
    return JSON.parse(text);
  } catch (err) {
    console.warn("⚠️ Failed to parse orchestrator plan, falling back to sequential default tasks:", err);
    return buildSequentialTasks(userPrompt);
  }
}

async function generateOneMode({
  mode,
  userPrompt,
  fileName,
  selectedPaths,
  topK,
  imageBase64 = null,
  roomName = "RoomMedExam_base",
  additionalContext = "",
  action = "create",
  targetPath = null,
  existingContent = null
}) {
  if (!userPrompt.trim()) {
    return {
      blocked: true,
      status: 400,
      stage: "input",
      error: "Prompt is required."
    };
  }

  let baseContent = existingContent;
  if (action === "edit" && !baseContent && targetPath && exists(targetPath)) {
    baseContent = readTextSafe(targetPath, MAX_FILE_CHARS);
  }

  const { context, files } = buildContext({
    prompt: userPrompt,
    mode,
    selectedPaths: targetPath ? [...(selectedPaths || []), targetPath] : selectedPaths,
    topK
  });

  let prompt = `
You are connected to a local Unity/Cerebrum project.
You must generate files based on the reference project files below.

${context}
`;

  if (baseContent) {
    prompt += `
[EXISTING ${mode.toUpperCase()} FILE TO EDIT]
--- START EXISTING CONTENT ---
${baseContent}
--- END EXISTING CONTENT ---
INSTRUCTION FOR EDITING:
Modify the above existing file to implement the user request. Keep all valid parts and structures that don't need changes.
`;
  }

  if (additionalContext) {
    prompt += `\n[ADDITIONAL PIPELINE CONTEXT]\n${additionalContext}\n`;
  }

  prompt += `
TASK MODE: ${mode} (${action === "edit" ? "EDIT EXISTING FILE" : "CREATE NEW FILE"})
${mode === "levelgen" ? `SELECTED ROOM: ${roomName}` : ""}
USER REQUEST:
${userPrompt}

OUTPUT RULES:
${outputRulesForMode(mode, roomName)}
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

  if (imageBase64) {
    ollamaBody.images = [imageBase64];
  }

  const data = await callOllama(ollamaBody);
  const script = cleanGenerated(data.response || "");
  const evaluation = localEvaluate(script, mode);

  const outputDir = getOutputDir(mode);
  fs.mkdirSync(outputDir, { recursive: true });

  const safeName = safeFileName(fileName);
  let savedPath;
  if (action === "edit" && targetPath) {
    savedPath = resolveSafeFilePath(targetPath, outputDir);
    fs.mkdirSync(path.dirname(savedPath), { recursive: true });
    fs.writeFileSync(savedPath, script, "utf8");
  } else {
    savedPath = path.join(outputDir, `${safeName}.txt`);
    fs.writeFileSync(savedPath, script, "utf8");
  }

  const activePath = path.join(outputDir, activeFileName(mode));
  fs.writeFileSync(activePath, script, "utf8");

  return {
    blocked: false,
    action: action === "edit" ? "edited" : "created",
    targetPath: savedPath,
    script,
    savedPath,
    activePath,
    mode,
    model: OLLAMA_MODEL,
    roomName: mode === "levelgen" ? roomName : undefined,
    usedFiles: files,
    localEvaluation: evaluation
  };
}

function localEvaluate(script, mode) {
  const errors = [];
  const warnings = [];
  const lines = (script || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

  if (mode === "character") {
    if (!lines.some((l) => l.includes("$Patient") || l.includes("$Temp") || l.includes("$HR") || l.includes("$BP"))) {
      warnings.push("Character output does not appear to initialize patient vitals or reference variables.");
    }
    if (!lines.some((l) => l.startsWith("Do '") || l.startsWith("Do $Patient") || l.includes("SetHair") || l.includes("PatientCreations"))) {
      warnings.push("No character appearance Do statements found.");
    }
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

app.get("/api/component-files", (req, res) => {
  try {
    const allFiles = getAllKnowledgeFiles();
    const levelgen = [];
    const character = [];
    const scenario = [];

    for (const f of allFiles) {
      const relLower = f.rel.toLowerCase();
      const baseName = path.basename(f.path);
      const item = {
        name: baseName,
        rel: f.rel,
        path: f.path,
        size: f.size
      };

      if (relLower.includes("levelgen") || baseName.toLowerCase().includes("room")) {
        levelgen.push(item);
      } else if (relLower.includes("patient") || relLower.includes("character")) {
        character.push(item);
      } else if (relLower.includes("scenario")) {
        scenario.push(item);
      }
    }

    const activeLg = path.join(getOutputDir("levelgen"), activeFileName("levelgen"));
    if (exists(activeLg)) {
      levelgen.unshift({ name: "ActiveGeneratedLevelGen.txt", rel: "ActiveGeneratedLevelGen.txt", path: activeLg, size: fs.statSync(activeLg).size });
    }

    res.json({
      ok: true,
      levelgen: [...new Map(levelgen.map((i) => [i.path, i])).values()],
      character: [...new Map(character.map((i) => [i.path, i])).values()],
      scenario: [...new Map(scenario.map((i) => [i.path, i])).values()]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list component files", details: err.message });
  }
});

app.post("/api/save-file", (req, res) => {
  try {
    const { filePath, content, mode, fileName } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content string is required." });
    }

    const outputDir = getOutputDir(mode || "scenario");
    let targetPath;

    if (filePath) {
      targetPath = resolveSafeFilePath(filePath, outputDir);
    } else {
      const safeName = safeFileName(fileName || (mode === "levelgen" ? "SavedLevel" : mode === "character" ? "SavedCharacter" : "SavedScenario"));
      targetPath = path.join(outputDir, `${safeName}.txt`);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");

    if (mode) {
      const activePath = path.join(outputDir, activeFileName(mode));
      fs.writeFileSync(activePath, content, "utf8");
    }

    res.json({
      ok: true,
      savedPath: targetPath,
      bytes: Buffer.byteLength(content, "utf8"),
      mode
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save file.", details: err.message });
  }
});

app.post("/api/edit-component", async (req, res) => {
  try {
    const { mode = "scenario", prompt = "", currentContent = "", targetPath = "", roomName = "RoomMedExam_base" } = req.body;
    if (!prompt.trim()) {
      return res.status(400).json({ error: "Edit prompt is required." });
    }

    let existingText = currentContent;
    if (!existingText && targetPath && exists(targetPath)) {
      existingText = readTextSafe(targetPath, MAX_FILE_CHARS);
    }

    const { context } = buildContext({
      prompt,
      mode,
      selectedPaths: targetPath ? [targetPath] : [],
      topK: 6
    });

    const editPrompt = `
You are connected to a local Unity/Cerebrum project as the specialized ${mode.toUpperCase()} component agent.
Your task is to EDIT and REFINE the existing ${mode} script based on the user's instructions.

${context}

EXISTING SCRIPT:
--- BEGIN CURRENT FILE ---
${existingText}
--- END CURRENT FILE ---

USER EDIT INSTRUCTIONS:
${prompt}

RULES:
${outputRulesForMode(mode, roomName)}
Apply only the requested edits or additions while maintaining correct syntax, variables, and structure.
Do not explain.
Do not use markdown code fences.
Output only the complete edited raw script.
`;

    const data = await callOllama({
      model: OLLAMA_MODEL,
      prompt: editPrompt,
      stream: false
    });

    const updatedScript = cleanGenerated(data.response || "");
    const evaluation = localEvaluate(updatedScript, mode);

    let savedPath = null;
    if (targetPath) {
      savedPath = resolveSafeFilePath(targetPath, getOutputDir(mode));
      fs.mkdirSync(path.dirname(savedPath), { recursive: true });
      fs.writeFileSync(savedPath, updatedScript, "utf8");
    }

    res.json({
      ok: true,
      mode,
      script: updatedScript,
      savedPath,
      localEvaluation: evaluation
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Component edit error.", details: err.message });
  }
});

app.post("/generate", upload.single("image"), async (req, res) => {
  try {
    const mode = req.body.mode || "scenario";
    const userPrompt = req.body.prompt || "";
    const defaultName = mode === "levelgen"
      ? "GeneratedLevel"
      : mode === "character"
        ? "GeneratedCharacter"
        : "GeneratedScenario";
    const fileName = safeFileName(req.body.fileName || defaultName);
    const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
    const topK = Number(req.body.topK || DEFAULT_TOP_K);
    const imageBase64 = req.file ? req.file.buffer.toString("base64") : null;
    const action = req.body.action || "create";
    const targetPath = req.body.targetPath || null;

    const result = await generateOneMode({
      mode,
      userPrompt,
      fileName,
      selectedPaths,
      topK,
      imageBase64,
      action,
      targetPath
    });

    if (result.blocked) {
      return res.status(result.status || 400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error.", details: err.message });
  }
});

app.post("/generate-sequential", upload.single("image"), async (req, res) => {
  try {
    const userPrompt = req.body.prompt || "";
    const roomName = req.body.roomName || "RoomMedExam_base";
    const baseName = safeFileName(req.body.fileName || "SequentialGeneration");
    const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
    const topK = Number(req.body.topK || DEFAULT_TOP_K);
    const imageBase64 = req.file ? req.file.buffer.toString("base64") : null;

    let componentConfigs = {};
    if (req.body.componentConfigs) {
      try {
        componentConfigs = typeof req.body.componentConfigs === "string"
          ? JSON.parse(req.body.componentConfigs)
          : req.body.componentConfigs;
      } catch (e) {
        console.warn("Could not parse componentConfigs", e);
      }
    }

    if (!userPrompt.trim()) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    console.log(`🤖 Orchestrator planning started for prompt: "${userPrompt}"`);
    const plan = await runOrchestrator(userPrompt, roomName, componentConfigs);
    console.log(`📋 Orchestrator plan generated:`, JSON.stringify(plan, null, 2));

    const results = {};

    // 1. LevelGen Agent
    console.log("🛠️ Running LevelGen Agent...");
    const lgConfig = componentConfigs.levelgen || {};
    const lgFileName = lgConfig.fileName ? safeFileName(lgConfig.fileName) : `${baseName}_LevelGen`;
    results.levelgen = await generateOneMode({
      mode: "levelgen",
      userPrompt: `You are the LevelGen Agent. Your task is defined in the Master Simulation Plan under "levelgen_task":\n"${plan.levelgen_task || plan.levelgen || userPrompt}"\n\nReference the Master Plan context:\nGoal: ${plan.goal}`,
      fileName: lgFileName,
      selectedPaths,
      topK,
      imageBase64,
      roomName,
      additionalContext: `MASTER SIMULATION PLAN:\n${JSON.stringify(plan, null, 2)}`,
      action: lgConfig.action || "create",
      targetPath: lgConfig.targetPath || null,
      existingContent: lgConfig.existingContent || null
    });

    if (results.levelgen.blocked) {
      return res.status(results.levelgen.status || 400).json({
        error: "Sequential generation stopped at LevelGen.",
        stoppedAt: "levelgen",
        orchestratorPlan: plan,
        results
      });
    }

    // 2. Character Agent
    console.log("👤 Running Character Agent...");
    const chConfig = componentConfigs.character || {};
    const chFileName = chConfig.fileName ? safeFileName(chConfig.fileName) : `${baseName}_Character`;
    let characterContext = `MASTER SIMULATION PLAN:\n${JSON.stringify(plan, null, 2)}`;
    if (results.levelgen?.script) {
      characterContext += `\n\nGENERATED LEVELGEN LAYOUT (YOU MUST COORDINATE AND PLACE PATIENT IN A SUPPORTED BED/SLOT DETECTED HERE):\n${results.levelgen.script}`;
    }

    results.character = await generateOneMode({
      mode: "character",
      userPrompt: `You are the Character Agent. Your task is defined in the Master Simulation Plan under "character_task":\n"${plan.character_task || plan.character || userPrompt}"\n\nReference the Master Plan context:\nGoal: ${plan.goal}`,
      fileName: chFileName,
      selectedPaths,
      topK,
      imageBase64: null,
      roomName,
      additionalContext: characterContext,
      action: chConfig.action || "create",
      targetPath: chConfig.targetPath || null,
      existingContent: chConfig.existingContent || null
    });

    if (results.character.blocked) {
      return res.status(results.character.status || 400).json({
        error: "Sequential generation stopped at Character.",
        stoppedAt: "character",
        orchestratorPlan: plan,
        results
      });
    }

    // 3. Scenario Agent
    console.log("🎬 Running Scenario Agent...");
    const scConfig = componentConfigs.scenario || {};
    const scFileName = scConfig.fileName ? safeFileName(scConfig.fileName) : `${baseName}_Scenario`;
    let scenarioContext = `MASTER SIMULATION PLAN:\n${JSON.stringify(plan, null, 2)}`;
    if (results.levelgen?.script) {
      scenarioContext += `\n\nGENERATED LEVELGEN LAYOUT (YOU MUST MATCH THIS EXACT LAYOUT AND SLOTS/PREFABS):\n${results.levelgen.script}`;
    }
    if (results.character?.script) {
      scenarioContext += `\n\nGENERATED CHARACTER SETUP (YOU MUST INTEGRATE OR REFER TO THESE VARIABLES):\n${results.character.script}`;
    }

    results.scenario = await generateOneMode({
      mode: "scenario",
      userPrompt: `You are the Scenario Agent. Your task is defined in the Master Simulation Plan under "scenario_task":\n"${plan.scenario_task || plan.scenario || userPrompt}"\n\nReference the Master Plan context:\nGoal: ${plan.goal}`,
      fileName: scFileName,
      selectedPaths,
      topK,
      imageBase64: null,
      roomName,
      additionalContext: scenarioContext,
      action: scConfig.action || "create",
      targetPath: scConfig.targetPath || null,
      existingContent: scConfig.existingContent || null
    });

    if (results.scenario.blocked) {
      return res.status(results.scenario.status || 400).json({
        error: "Sequential generation stopped at Scenario.",
        stoppedAt: "scenario",
        orchestratorPlan: plan,
        results
      });
    }

    res.json({
      ok: true,
      orchestratorPlan: plan,
      order: ["levelgen", "character", "scenario"],
      results
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Sequential generation error.",
      details: err.message
    });
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

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require('dotenv').config();


const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const DEFAULT_PROVIDER = process.env.MODEL_PROVIDER || "ollama";
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.LOCAL_MODEL || "gemma3:4b";

const GEMINI_MODELS = process.env.GEMINI_MODELS ? process.env.GEMINI_MODELS.split(",").map(s => s.trim()).filter(Boolean) : ["gemini-3.6-flash", "gemini-3.5-pro", "gemini-3.0-pro", "gemini-2.5-flash"];
const OLLAMA_MODELS = process.env.OLLAMA_MODELS ? process.env.OLLAMA_MODELS.split(",").map(s => s.trim()).filter(Boolean) : ["gemma3:4b", "gemma4:e2b", "llama3:8b"];

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
  files.push(...walkFiles(path.join(__dirname, "MCP", "remoteMCP", "daemon", "Scenario")));
  files.push(...walkFiles(path.join(__dirname, "MCP", "remoteMCP", "daemon", "Patient")));

  const candidateExtraFiles = [
    path.join(__dirname, "MainLoop.txt"),
    path.join(PROJECT_ROOT, "MainLoop.txt"),
    path.join(__dirname, "CerebrumScriptingGuide_1.2.0.txt"),
    path.join(PROJECT_ROOT, "CerebrumScriptingGuide_1.2.0.txt")
  ];
  for (const p of candidateExtraFiles) {
    if (exists(p)) files.push(p);
  }

  return [...new Set(files)].map((filePath) => {
    const text = readTextSafe(filePath);
    const rel = projectRelative(filePath);
    const relLower = rel.toLowerCase();

    let priority = 100;
    if (filePath.includes("corrected-levelgen-examples")) priority = 1000;
    else if (filePath.includes("manual-levelgen-examples")) priority = 800;
    else if (relLower.includes("mainloop")) priority = 1500;
    else if (relLower.includes("patientnews")) priority = 1500;
    else if (relLower.includes("scriptingguide")) priority = 900;
    else if (relLower.includes("levelgen")) priority = 300;
    else if (relLower.includes("scenario")) priority = 300;
    else if (relLower.includes("patient")) priority = 300;

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
  if (mode === "levelgen" && rel.includes("manual-levelgen")) score += 500;

  if (mode === "scenario") {
    if (rel.includes("mainloop")) score += 2000; // MainLoop is the gold standard
    if (rel.includes("scenario")) score += 500;
    if (file.text.includes("Label '") || file.text.includes("pressed")) score += 400;
    if (file.text.includes("Do '")) score += 250;
  }

  if (mode === "character") {
    if (rel.includes("patientnews")) score += 2000; // PatientNews1 is the gold standard
    if (rel.includes("patient") || rel.includes("character") || rel.includes("appearance")) score += 700;
    if (file.text.includes("$patientname") || file.text.includes("patientcreations")) score += 600;
  }

  return score;
}

function buildContext({ prompt, mode, selectedPaths = [], topK = DEFAULT_TOP_K }) {
  const memoryPath = mode === "scenario"
    ? path.join(__dirname, "MCP", "remoteMCP", "daemon", "Workspace Memory Scenario.txt")
    : mode === "character"
      ? path.join(__dirname, "MCP", "remoteMCP", "daemon", "Workspace Memory Character.txt")
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
    return `Generate an authentic Cerebrum character/patient setup scenario script (.txt) following the Cerebrum Scripting Guide and PatientNews1.txt.
Output only raw script lines.
MANDATORY 3-PHASE STRUCTURE:
Phase 1 - Patient Identity & Clinical Vitals:
$PatientName = '...'
$isEWS = 'true'
$PatientIC = '...'
$BloodType = '...'
$AgeInYears = ...
$PatientModel = 'uAvatar'
$PatientDiag = '...'
$PatientGender = 'Male' or 'Female'
$PatientSummary = '...'
$PatientType = 'News1'
### Set patient vitals
$Temperature = 38.6
$HR = 88
$BP = '138/84'
$BPSys = 138
$Respiration = 22
$SpO2 = 94
$PainScore = 'Pain Score: ...'
$AbnormalResponse = '...'
$PatientSpeak = '...'
Phase 2 - Model Instantiation & Bed Alignment:
$PatientObjName = 'PatientNewsA_B' + BedNumber
Create $PatientModel $PatientObjName
$PatientBedLoc = $Patient
$PatientObjName align $PatientBedLoc 0
$Patient = PatientObjName
$RigType = 'uAvatar'
Do 'Rigs/RigExtras.txt'
Do 'NEWS_Nurse/SetupPatient.txt'
Phase 3 - Appearance & Trait Customization:
$HeadAmount = 80.0
$WeightAmount = 20.0
Do 'NEWS_Nurse/PatientCreations/Age/<age>.txt'
Do 'NEWS_Nurse/PatientCreations/Head/<head>.txt'
Do 'NEWS_Nurse/PatientCreations/Height/<height>.txt'
Do 'NEWS_Nurse/PatientCreations/Weight/<weight>.txt'
Do 'NEWS_Nurse/PatientCreations/Expressions/<expression>.txt'
Return
Do NOT generate LevelGen room layout rows or scenario interactive loops in the character script.`;
  }
  return `Generate an authentic Cerebrum scenario (.txt) script strictly following MainLoop.txt and the Cerebrum Scripting Guide.
Output only raw script lines.
MANDATORY STRUCTURE:
1. Setup Canvases & Outlines:
   JoystickCanvas on
   WipeCanvas off
   SyringeCanvas off
   IVCanvas off
   $Patient outline.on
   $Vitalsmonitor outline.on
   $KidneyDish outline.on
   $KidneyDish reset
2. Player Alignment:
   If
       $Patient isCurrent
   Then
       Player align $PlayerStart 0.5
   Endif
3. Main Interaction Loop (AS SEEN IN MAINLOOP.TXT):
   Label 'MainLoop'
       # Interactive click checks (Condition on own line, Then on own line, MUST reset object!)
       If
           $Patient pressed
       Then
           $Patient reset
           $Patient outline.off
           Do 'NEWS_Nurse/EngagePatient.txt'
           $Patient outline.on
       Endif

       If
           $HandScrub pressed
       Then
           $HandScrub reset
           Prompt 'Hand Hygiene'
           Do 'Actions/HandWash/StandardHandHygiene.txt'
           Wait 1
           Prompt ''
           Player align $PlayerStart 0.5
       Endif

       If
           $Vitalsmonitor pressed
       Then
           $Vitalsmonitor reset
           Do 'Intervention/AssessECG.txt'
       Endif

       Wait .2
   Goto 'MainLoop'
4. Prompts & Dialogue:
   Prompt 'Message text'
   Wait 1.5
   Prompt ''
5. End with Return.
CRITICAL: Every 'If' MUST have its conditional expression on the line following 'If', followed by 'Then' on its own line, the block body, and 'Endif'. Any clicked object check ($Object pressed) MUST immediately be followed by $Object reset.`;
}

function buildSequentialTasks(userPrompt) {
  return {
    title: "Sequential Simulation Plan",
    goal: "Fulfill the user request sequentially",
    levelgen_task: `Generate the physical room/environment setup only. Do not write scenario behavior or detailed character appearance. Overall request:\n${userPrompt}`,
    character_task: `Generate the authentic patient setup and appearance customization following Cerebrum PatientNews1.txt (patient variables, vitals, model creation/bed alignment, and PatientCreations Do calls). Overall request:\n${userPrompt}`,
    scenario_task: `Generate the scenario clinical flow and interactive loop following Cerebrum MainLoop.txt (canvases, outlines, multi-line If/Then/Endif, object click resets, throttled MainLoop, and Return). Overall request:\n${userPrompt}`
  };
}

async function runOrchestrator(userPrompt, roomName, componentConfigs = {}, modelOpts = {}) {
  const provider = modelOpts.provider || DEFAULT_PROVIDER;
  const model = modelOpts.model || (provider.toLowerCase() === "gemini" ? DEFAULT_GEMINI_MODEL : OLLAMA_MODEL);

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
2. Character Agent ("character_task"): For creating or modifying the character/patient setup script following the Cerebrum Scripting Guide and PatientNews1.txt. Must specify 3 phases: Phase 1 (Patient clinical variables $PatientName, $PatientAge, and vitals $Temperature, $HR, $BP, $Respiration, $SpO2, $PatientSpeak), Phase 2 (Model creation and bed alignment: Create $PatientModel $PatientObjName, align to bed), and Phase 3 (Appearance blendshape Do calls like Age, Head, Height, Weight, Expressions).
3. Scenario Agent ("scenario_task"): For scripting clinical workflow logic following Cerebrum MainLoop.txt (Canvases on/off, object outlines, player alignment, multi-line If/Then/Endif, interactive object click handling with $Object reset, throttled event loop Label 'MainLoop' ... Wait .2 ... Goto 'MainLoop', and ending with Return).

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
    const data = await callModel({
      provider,
      model,
      prompt,
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
  existingContent = null,
  provider = DEFAULT_PROVIDER,
  model = null
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

  const activeModel = model || (provider.toLowerCase() === "gemini" ? DEFAULT_GEMINI_MODEL : OLLAMA_MODEL);
  const data = await callModel({
    provider,
    model: activeModel,
    prompt,
    imageBase64
  });

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
    provider,
    model: activeModel,
    roomName: mode === "levelgen" ? roomName : undefined,
    usedFiles: files,
    localEvaluation: evaluation
  };
}

function localEvaluate(script, mode, expectedRoomName = null) {
  const errors = [];
  const warnings = [];

  const raw = String(script || "").trim();
  if (!raw) errors.push("Generated file is empty.");
  if (raw.includes("```")) errors.push("Generated file still contains markdown code fences.");

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (mode === "scenario") {
    // Check multi-line If syntax (Cerebrum requirement)
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^if\s+.+\s+then$/i.test(l)) {
        warnings.push(`Single-line If/Then detected at line ${i + 1}: "${l}". Cerebrum requires condition and Then on separate lines.`);
      }
      if (/^if$/i.test(l)) {
        if (i + 2 >= lines.length || !/^then$/i.test(lines[i + 2])) {
          warnings.push(`Malformed If statement at line ${i + 1}. Expected: If \\n [condition] \\n Then.`);
        }
      }
      if (/\bpressed\b/i.test(l) && !l.startsWith("#")) {
        const resetObj = l.replace(/\bpressed\b/i, "").trim().split(/\s+/)[0];
        let hasReset = false;
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (lines[j].includes("reset")) { hasReset = true; break; }
        }
        if (!hasReset && resetObj) {
          warnings.push(`Object click check "${l}" may be missing "${resetObj} reset", which can cause stuck button loops.`);
        }
      }
    }

    // Check If / Endif balance
    const ifCount = lines.filter((l) => /^if(\s|$)/i.test(l)).length;
    const endifCount = lines.filter((l) => /^endif$/i.test(l)).length;
    if (ifCount !== endifCount) {
      errors.push(`Mismatched conditionals: found ${ifCount} If statements but ${endifCount} Endif statements.`);
    }

    // Check Label and Goto pairing
    const labels = new Set(
      lines
        .filter((l) => /^label\s+['"][^'"]+['"]/i.test(l))
        .map((l) => l.replace(/^label\s+['"]([^'"]+)['"].*/i, "$1"))
    );
    for (const l of lines) {
      if (/^goto\s+['"][^'"]+['"]/i.test(l)) {
        const target = l.replace(/^goto\s+['"]([^'"]+)['"].*/i, "$1");
        if (!labels.has(target)) {
          warnings.push(`Goto references undefined label "${target}".`);
        }
      }
    }

    // Check loop throttle
    if (lines.some((l) => /^goto\s+/i.test(l))) {
      if (!lines.some((l) => /^wait\s+/i.test(l))) {
        warnings.push("Scenario contains a Goto loop but no Wait statements to throttle loop execution.");
      }
    }

    // Check Return
    if (lines.length > 0 && !lines.some((l) => /^return(\s|$)/i.test(l))) {
      warnings.push("Scenario script does not contain a Return statement.");
    }
  }

  if (mode === "character") {
    const textLower = raw.toLowerCase();
    if (!textLower.includes("$patientname")) warnings.push("Missing $PatientName declaration.");
    if (!textLower.includes("$temperature") && !textLower.includes("$hr")) {
      warnings.push("Missing clinical vitals ($Temperature, $HR, $BP, etc.).");
    }
    if (!textLower.includes("create $patientmodel") && !textLower.includes("create uavatar")) {
      warnings.push("Missing patient avatar creation (Create $PatientModel $PatientObjName).");
    }
    if (!textLower.includes("align")) {
      warnings.push("Missing patient bed alignment ($PatientObjName align $PatientBedLoc 0).");
    }
    if (!textLower.includes("patientcreations")) {
      warnings.push("Missing modular styling Do scripts (e.g., Do 'NEWS_Nurse/PatientCreations/Age/...').");
    }
    if (!lines.some((l) => /^return(\s|$)/i.test(l))) {
      warnings.push("Character setup script does not end with Return.");
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

function getGeminiApiKey() {
  let key = process.env.GEMINI_API_KEY;
  if (key && key !== "key_here" && key !== "insert key" && key !== '""' && key !== "''") {
    return key.replace(/^["']|["']$/g, "").trim();
  }

  const candidateEnvPaths = [
    path.join(__dirname, ".env"),
    path.join(__dirname, "MCP", "remoteMCP", "daemon", ".env"),
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "MCP", "remoteMCP", "daemon", ".env")
  ];

  for (const p of candidateEnvPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf8");
        const match = content.match(/^GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1] && match[1] !== "key_here" && match[1] !== "insert key") {
          const val = match[1].trim();
          process.env.GEMINI_API_KEY = val;
          return val;
        }
      } catch {}
    }
  }
  return null;
}

async function callGemini({ prompt, model = DEFAULT_GEMINI_MODEL, systemInstruction = null, imageBase64 = null, format = null }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const parts = [];
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: "image/png",
        data: imageBase64
      }
    });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: "user", parts }]
  };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }
  if (format === "json") {
    body.generationConfig = { response_mime_type: "application/json" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return { response: text };
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

async function callModel({
  prompt,
  provider = DEFAULT_PROVIDER,
  model = null,
  systemInstruction = null,
  imageBase64 = null,
  format = null
}) {
  const selectedProvider = (provider || DEFAULT_PROVIDER).toLowerCase();
  if (selectedProvider === "gemini") {
    const geminiModel = model || DEFAULT_GEMINI_MODEL;
    return await callGemini({ prompt, model: geminiModel, systemInstruction, imageBase64, format });
  }

  const ollamaModel = model || OLLAMA_MODEL;
  const body = {
    model: ollamaModel,
    prompt,
    stream: false
  };
  if (systemInstruction) body.system = systemInstruction;
  if (format) body.format = format;
  if (imageBase64) body.images = [imageBase64];
  return await callOllama(body);
}

app.get("/api/models", (req, res) => {
  res.json({
    ok: true,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModels: {
      gemini: DEFAULT_GEMINI_MODEL,
      ollama: OLLAMA_MODEL,
    },
    providers: {
      gemini: GEMINI_MODELS,
      ollama: OLLAMA_MODELS,
    },
  });
});

app.get("/api/status", (req, res) => {
  const files = getAllKnowledgeFiles();
  res.json({
    projectRoot: PROJECT_ROOT,
    streamingAssetsDir: STREAMING_ASSETS_DIR,
    scenariosDir: SCENARIOS_DIR,
    levelgenDir: LEVELGEN_DIR,
    localManualDir: LOCAL_MANUAL_DIR,
    localCorrectedDir: LOCAL_CORRECTED_DIR,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_PROVIDER === "gemini" ? DEFAULT_GEMINI_MODEL : OLLAMA_MODEL,
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
    const roomName = req.body.roomName || "RoomMedExam_base";
    const defaultName = mode === "levelgen"
      ? "GeneratedLevel"
      : mode === "character"
        ? "GeneratedCharacter"
        : "GeneratedScenario";
    const fileName = req.body.fileName || defaultName;
    const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
    const topK = Number(req.body.topK || DEFAULT_TOP_K);
    const imageBase64 = req.file ? req.file.buffer.toString("base64") : null;
    const provider = req.body.provider || DEFAULT_PROVIDER;
    const model = req.body.model || null;

    const result = await generateOneMode({
      mode,
      userPrompt,
      fileName,
      selectedPaths,
      topK,
      imageBase64,
      roomName,
      provider,
      model
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

app.post(["/generate-sequential", "/api/orchestrate/generate-sequential"], upload.single("image"), async (req, res) => {
  try {
    const userPrompt = req.body.prompt || req.body.userPrompt || "";
    const roomName = req.body.roomName || "RoomMedExam_base";
    const baseName = safeFileName(req.body.fileName || "SequentialGeneration");
    const selectedPaths = req.body.selectedPaths ? JSON.parse(req.body.selectedPaths) : [];
    const topK = Number(req.body.topK || DEFAULT_TOP_K);
    const imageBase64 = req.file ? req.file.buffer.toString("base64") : null;
    const provider = req.body.provider || DEFAULT_PROVIDER;
    const model = req.body.model || null;

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

    const tPipelineStart = performance.now();

    console.log(`🤖 Orchestrator planning started [${provider}/${model || "default"}] for prompt: "${userPrompt}"`);
    const tPlanStart = performance.now();
    const plan = await runOrchestrator(userPrompt, roomName, componentConfigs, { provider, model });
    const planningMs = performance.now() - tPlanStart;
    console.log(`📋 Orchestrator plan generated in ${planningMs.toFixed(1)}ms:`, JSON.stringify(plan, null, 2));

    const results = {};

    // 1. LevelGen Agent
    console.log("🛠️ Running LevelGen Agent...");
    const tLgStart = performance.now();
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
      existingContent: lgConfig.existingContent || null,
      provider,
      model
    });
    const levelgenMs = performance.now() - tLgStart;

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
    const tChStart = performance.now();
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
      existingContent: chConfig.existingContent || null,
      provider,
      model
    });
    const characterMs = performance.now() - tChStart;

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
    const tScStart = performance.now();
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
      existingContent: scConfig.existingContent || null,
      provider,
      model
    });
    const scenarioMs = performance.now() - tScStart;

    if (results.scenario.blocked) {
      return res.status(results.scenario.status || 400).json({
        error: "Sequential generation stopped at Scenario.",
        stoppedAt: "scenario",
        orchestratorPlan: plan,
        results
      });
    }

    const totalPipelineMs = performance.now() - tPipelineStart;

    res.json({
      ok: true,
      provider,
      model: model || (provider.toLowerCase() === "gemini" ? DEFAULT_GEMINI_MODEL : OLLAMA_MODEL),
      orchestratorPlan: plan,
      order: ["levelgen", "character", "scenario"],
      results,
      timings: {
        planningMs,
        levelgenMs,
        characterMs,
        scenarioMs,
        totalPipelineMs
      }
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
    const provider = req.body.provider || DEFAULT_PROVIDER;
    const model = req.body.model || null;

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
    let modelEvaluation = null;
    try {
      const data = await callModel({
        provider,
        model,
        prompt: evalPrompt,
        format: "json"
      });
      try {
        modelEvaluation = JSON.parse(data.response || "{}");
      } catch {
        modelEvaluation = { raw: data.response };
      }
    } catch (evalErr) {
      modelEvaluation = { note: "Model evaluation skipped or offline", error: evalErr.message };
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

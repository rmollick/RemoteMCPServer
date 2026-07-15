import fs from "fs";
import path from "path";

const MAX_FILE_CHARS = Number(
  process.env.UNITY_RAG_MAX_FILE_CHARS || 12000
);

const MAX_CONTEXT_CHARS = Number(
  process.env.UNITY_RAG_MAX_CONTEXT_CHARS || 48000
);

const DEFAULT_TOP_K = Number(
  process.env.UNITY_RAG_TOP_K || 10
);

const TEXT_EXTENSIONS = new Set([
  ".cs",
  ".txt",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".md",
  ".asmdef",
  ".shader",
  ".cginc",
  ".csv",
  ".ini",
  ".cfg"
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "Library",
  "Temp",
  "Logs",
  "obj",
  "Build",
  "Builds",
  "UserSettings",
  ".vs",
  ".idea"
]);

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function normalize(filePath) {
  return String(filePath || "").replaceAll("\\", "/");
}

function readText(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .slice(0, MAX_FILE_CHARS);
  } catch {
    return "";
  }
}

function walk(
  directory,
  root,
  output,
  depth = 0,
  maxDepth = 18
) {
  if (!exists(directory) || depth > maxDepth) {
    return;
  }

  let entries = [];

  try {
    entries = fs.readdirSync(directory, {
      withFileTypes: true
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      SKIP_DIRS.has(entry.name)
    ) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(
        fullPath,
        root,
        output,
        depth + 1,
        maxDepth
      );

      continue;
    }

    const extension = path
      .extname(entry.name)
      .toLowerCase();

    if (!TEXT_EXTENSIONS.has(extension)) {
      continue;
    }

    const relativePath = normalize(
      path.relative(root, fullPath)
    );

    const lowercasePath = relativePath.toLowerCase();

    const inStreamingAssets =
      lowercasePath.includes("streamingassets/") ||
      lowercasePath.startsWith("streamingassets/");

    const isCSharp = extension === ".cs";

    /*
     * Project-wide retrieval only needs:
     * - Unity C# scripts
     * - StreamingAssets files
     * - Assembly definition files
     */
    if (
      !inStreamingAssets &&
      !isCSharp &&
      extension !== ".asmdef"
    ) {
      continue;
    }

    const text = readText(fullPath);

    if (!text.trim()) {
      continue;
    }

    output.push({
      path: fullPath,
      rel: relativePath,
      text,
      ext: extension,
      inStreamingAssets,
      isCSharp
    });
  }
}

function tokenize(value) {
  return [
    ...new Set(
      String(value || "")
        .replace(
          /([a-z0-9])([A-Z])/g,
          "$1 $2"
        )
        .toLowerCase()
        .replace(
          /[^a-z0-9_./\\-]+/g,
          " "
        )
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    )
  ];
}

function quotedStrings(value) {
  const results = [];
  const regex = /["']([^"'\r\n]{3,160})["']/g;

  let match;

  while (
    (match = regex.exec(String(value || ""))) !== null
  ) {
    results.push(match[1]);
  }

  return [...new Set(results)].slice(0, 50);
}

function scoreFile(file, query, mode) {
  const queryTokens = tokenize(query);
  const relativePath = file.rel.toLowerCase();
  const lowercaseText = file.text.toLowerCase();

  let score = 0;

  if (file.inStreamingAssets) {
    score += mode === "evaluation" ? 900 : 500;
  }

  if (file.isCSharp) {
    score += mode === "evaluation" ? 500 : 700;
  }

  if (relativePath.includes("generated")) {
    score -= 100;
  }

  if (relativePath.includes("editor/")) {
    score += query
      .toLowerCase()
      .includes("editor")
      ? 200
      : -20;
  }

  for (const token of queryTokens) {
    if (relativePath.includes(token)) {
      score += 55;
    }

    if (lowercaseText.includes(token)) {
      score += 12;
    }
  }

  for (const literal of quotedStrings(query)) {
    const lowercaseLiteral = literal.toLowerCase();

    if (relativePath.includes(lowercaseLiteral)) {
      score += 250;
    }

    if (lowercaseText.includes(lowercaseLiteral)) {
      score += 120;
    }
  }

  return score;
}

function selectedRecords(
  workspaceRoot,
  selectedPreviews = []
) {
  return selectedPreviews
    .filter(
      (item) =>
        item &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .map((item) => ({
      path: path.resolve(
        workspaceRoot,
        item.path || ""
      ),

      rel: normalize(
        item.path || "selected-file"
      ),

      text: item.content.slice(
        0,
        MAX_FILE_CHARS
      ),

      ext: path
        .extname(item.path || "")
        .toLowerCase(),

      inStreamingAssets: normalize(
        item.path || ""
      )
        .toLowerCase()
        .includes("streamingassets/"),

      isCSharp:
        path
          .extname(item.path || "")
          .toLowerCase() === ".cs",

      selected: true,
      score: 100000
    }));
}

export function retrieveUnityProjectContext({
  workspaceRoot,
  query,
  selectedPreviews = [],
  mode = "generation",
  topK = DEFAULT_TOP_K
}) {
  const allFiles = [];

  const assetsDirectory = path.join(
    workspaceRoot,
    "Assets"
  );

  if (exists(assetsDirectory)) {
    walk(
      assetsDirectory,
      workspaceRoot,
      allFiles
    );
  } else {
    /*
     * Built Unity projects may place StreamingAssets
     * below a directory ending in "_Data".
     */
    walk(
      workspaceRoot,
      workspaceRoot,
      allFiles,
      0,
      8
    );
  }

  const selectedFiles = selectedRecords(
    workspaceRoot,
    selectedPreviews
  );

  const selectedRelativePaths = new Set(
    selectedFiles.map((file) =>
      file.rel.toLowerCase()
    )
  );

  const rankedFiles = allFiles
    .filter(
      (file) =>
        !selectedRelativePaths.has(
          file.rel.toLowerCase()
        )
    )
    .map((file) => ({
      ...file,
      score: scoreFile(
        file,
        query,
        mode
      )
    }))
    .sort(
      (first, second) =>
        second.score - first.score ||
        first.rel.localeCompare(second.rel)
    );

  const streamingAssetsFiles = rankedFiles
    .filter((file) => file.inStreamingAssets)
    .slice(
      0,
      Math.max(
        4,
        Math.ceil(topK / 2)
      )
    );

  const cSharpFiles = rankedFiles
    .filter((file) => file.isCSharp)
    .slice(
      0,
      Math.max(
        4,
        Math.ceil(topK / 2)
      )
    );

  const deduplicatedFiles = [];
  const seenFiles = new Set();

  for (
    const file of [
      ...selectedFiles,
      ...streamingAssetsFiles,
      ...cSharpFiles,
      ...rankedFiles
    ]
  ) {
    const key = file.rel.toLowerCase();

    if (seenFiles.has(key)) {
      continue;
    }

    seenFiles.add(key);
    deduplicatedFiles.push(file);

    if (
      deduplicatedFiles.length >=
      selectedFiles.length +
        Number(topK || DEFAULT_TOP_K)
    ) {
      break;
    }
  }

  let context = "";
  const usedFiles = [];

  for (const file of deduplicatedFiles) {
    const block =
      `\n--- PROJECT REFERENCE: ${file.rel} ---\n` +
      `${file.text}\n`;

    if (
      (context + block).length >
      MAX_CONTEXT_CHARS
    ) {
      break;
    }

    context += block;

    usedFiles.push({
      rel: file.rel,
      inStreamingAssets: Boolean(
        file.inStreamingAssets
      ),
      isCSharp: Boolean(file.isCSharp),
      selected: Boolean(file.selected),
      score: file.score || 0
    });
  }

  const allStreamingAssetsFiles = allFiles.filter(
    (file) => file.inStreamingAssets
  );

  const streamingAssetsRoots = [
    ...new Set(
      allStreamingAssetsFiles.map((file) => {
        const lowercasePath =
          file.rel.toLowerCase();

        const marker =
          lowercasePath.indexOf(
            "streamingassets/"
          );

        return marker >= 0
          ? file.rel.slice(
              0,
              marker +
                "StreamingAssets".length
            )
          : "StreamingAssets";
      })
    )
  ];

  return {
    context: context.trim(),
    files: usedFiles,
    indexedFileCount: allFiles.length,

    streamingAssetsFileCount:
      allStreamingAssetsFiles.length,

    streamingAssetsRoots,

    hasStreamingAssetsEvidence:
      usedFiles.some(
        (file) => file.inStreamingAssets
      )
  };
}

function stripCodeFences(script) {
  return String(script || "")
    .replace(
      /^```(?:csharp|cs)?\s*/i,
      ""
    )
    .replace(/```\s*$/i, "")
    .trim();
}

function delimiterErrors(code) {
  const pairs = {
    "{": "}",
    "(": ")",
    "[": "]"
  };

  const openings = new Set(
    Object.keys(pairs)
  );

  const closings = new Set(
    Object.values(pairs)
  );

  const stack = [];

  let state = "code";
  let verbatim = false;

  for (
    let index = 0;
    index < code.length;
    index++
  ) {
    const currentCharacter = code[index];
    const nextCharacter = code[index + 1];

    if (state === "lineComment") {
      if (currentCharacter === "\n") {
        state = "code";
      }

      continue;
    }

    if (state === "blockComment") {
      if (
        currentCharacter === "*" &&
        nextCharacter === "/"
      ) {
        state = "code";
        index++;
      }

      continue;
    }

    if (state === "string") {
      if (verbatim) {
        if (
          currentCharacter === '"' &&
          nextCharacter === '"'
        ) {
          index++;
          continue;
        }

        if (currentCharacter === '"') {
          state = "code";
          verbatim = false;
        }
      } else {
        if (currentCharacter === "\\") {
          index++;
          continue;
        }

        if (currentCharacter === '"') {
          state = "code";
        }
      }

      continue;
    }

    if (state === "char") {
      if (currentCharacter === "\\") {
        index++;
        continue;
      }

      if (currentCharacter === "'") {
        state = "code";
      }

      continue;
    }

    if (
      currentCharacter === "/" &&
      nextCharacter === "/"
    ) {
      state = "lineComment";
      index++;
      continue;
    }

    if (
      currentCharacter === "/" &&
      nextCharacter === "*"
    ) {
      state = "blockComment";
      index++;
      continue;
    }

    if (
      currentCharacter === "@" &&
      nextCharacter === '"'
    ) {
      state = "string";
      verbatim = true;
      index++;
      continue;
    }

    if (currentCharacter === '"') {
      state = "string";
      verbatim = false;
      continue;
    }

    if (currentCharacter === "'") {
      state = "char";
      continue;
    }

    if (openings.has(currentCharacter)) {
      stack.push({
        char: currentCharacter,
        index
      });
    }

    if (closings.has(currentCharacter)) {
      const top = stack.pop();

      if (
        !top ||
        pairs[top.char] !== currentCharacter
      ) {
        return [
          `Mismatched '${currentCharacter}' near character ${index}.`
        ];
      }
    }
  }

  if (state === "blockComment") {
    return ["Unclosed block comment."];
  }

  if (state === "string") {
    return ["Unclosed string literal."];
  }

  if (state === "char") {
    return ["Unclosed character literal."];
  }

  if (stack.length) {
    return stack.map(
      (item) =>
        `Unclosed '${item.char}' near character ${item.index}.`
    );
  }

  return [];
}

export function analyzeUnityScript(script) {
  const code = stripCodeFences(script);

  const errors = [];
  const warnings = [];
  const info = [];

  if (!code) {
    errors.push(
      "The generated Unity script is empty."
    );
  }

  errors.push(...delimiterErrors(code));

  const classMatches = [
    ...code.matchAll(
      /\b(?:public\s+|internal\s+|private\s+|protected\s+)?(?:sealed\s+|abstract\s+|partial\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/g
    )
  ];

  if (!classMatches.length) {
    errors.push(
      "No C# class declaration was found."
    );
  } else {
    info.push(
      `Classes found: ${classMatches
        .map((match) => match[1])
        .join(", ")}.`
    );
  }

  if (
    /\bMonoBehaviour\b/.test(code) &&
    !/using\s+UnityEngine\s*;/.test(code) &&
    !/UnityEngine\.MonoBehaviour/.test(code)
  ) {
    errors.push(
      "MonoBehaviour is used without importing UnityEngine."
    );
  }

  if (
    /\bIEnumerator\b/.test(code) &&
    !/using\s+System\.Collections\s*;/.test(
      code
    ) &&
    !/System\.Collections\.IEnumerator/.test(
      code
    )
  ) {
    errors.push(
      "IEnumerator is used without importing System.Collections."
    );
  }

  if (
    /\bList\s*</.test(code) &&
    !/using\s+System\.Collections\.Generic\s*;/.test(
      code
    ) &&
    !/System\.Collections\.Generic\.List/.test(
      code
    )
  ) {
    errors.push(
      "List<T> is used without importing System.Collections.Generic."
    );
  }

  if (
    /\bUnityWebRequest\b/.test(code) &&
    !/using\s+UnityEngine\.Networking\s*;/.test(
      code
    )
  ) {
    errors.push(
      "UnityWebRequest is used without importing UnityEngine.Networking."
    );
  }

  if (
    /\bNavMeshAgent\b/.test(code) &&
    !/using\s+UnityEngine\.AI\s*;/.test(code)
  ) {
    errors.push(
      "NavMeshAgent is used without importing UnityEngine.AI."
    );
  }

  if (
    /\b(?:TMP_Text|TextMeshProUGUI|TMP_InputField)\b/.test(
      code
    ) &&
    !/using\s+TMPro\s*;/.test(code)
  ) {
    errors.push(
      "TextMesh Pro types are used without importing TMPro."
    );
  }

  if (
    /\bTask(?:<|\s)/.test(code) &&
    !/using\s+System\.Threading\.Tasks\s*;/.test(
      code
    ) &&
    !/System\.Threading\.Tasks\.Task/.test(
      code
    )
  ) {
    errors.push(
      "Task is used without importing System.Threading.Tasks."
    );
  }

  if (
    /using\s+UnityEditor\s*;/.test(code) &&
    !/#if\s+UNITY_EDITOR/.test(code)
  ) {
    warnings.push(
      "UnityEditor is imported without an obvious UNITY_EDITOR guard; this script must be editor-only or placed in an Editor folder."
    );
  }

  if (
    /\basync\s+void\s+(?:Update|FixedUpdate|LateUpdate)\s*\(/.test(
      code
    )
  ) {
    warnings.push(
      "An async Unity frame callback can create overlapping operations and hard-to-handle exceptions."
    );
  }

  if (
    /GameObject\.Find\s*\(|FindObjectOfType\s*</.test(
      code
    )
  ) {
    warnings.push(
      "Scene-wide object lookup is used; verify performance and that object names/types are stable."
    );
  }

  if (
    /\bpublic\s+(?:GameObject|Transform|[A-Z][A-Za-z0-9_<>]*)\s+[a-zA-Z_][A-Za-z0-9_]*\s*;/.test(
      code
    )
  ) {
    info.push(
      "Public Inspector fields were detected; confirm they are assigned before Play Mode."
    );
  }

  const pathLiterals = quotedStrings(code).filter(
    (value) =>
      /[\\/]/.test(value) ||
      /\.(txt|json|csv|xml|prefab|unity|asset)$/i.test(
        value
      )
  );

  return {
    code,
    pass: errors.length === 0,
    errors,
    warnings,
    info,

    classNames: classMatches.map(
      (match) => match[1]
    ),

    pathLiterals
  };
}

export function parseJudgeJson(raw) {
  const cleaned = String(raw || "")
    .replace(
      /^```(?:json)?\s*/i,
      ""
    )
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(
          cleaned.slice(start, end + 1)
        );
      } catch {
        // Continue to fallback result.
      }
    }

    return {
      verdict: "UNPARSEABLE",
      score: 0,

      summary:
        cleaned ||
        "The judge returned no readable result."
    };
  }
}

function list(items) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return "- None found.";
  }

  return items
    .map((item) => {
      if (typeof item === "string") {
        return `- ${item}`;
      }

      return `- ${JSON.stringify(item)}`;
    })
    .join("\n");
}

export function formatUnityEvaluation({
  deterministic,
  rag,
  judge,
  provider,
  model
}) {
  const judgeVerdict = String(
    judge?.verdict || "UNPARSEABLE"
  ).toUpperCase();

  const rawJudgeScore = Number.isFinite(
    Number(judge?.score)
  )
    ? Math.max(
        0,
        Math.min(
          100,
          Number(judge.score)
        )
      )
    : 0;

  let finalVerdict = "PASS";

  if (!rag.hasStreamingAssetsEvidence) {
    finalVerdict = "NEEDS PROJECT CONTEXT";
  }

  if (
    !deterministic.pass ||
    [
      "FAIL",
      "REJECT",
      "UNPARSEABLE"
    ].includes(judgeVerdict)
  ) {
    finalVerdict = "FAIL";
  } else if (
    deterministic.warnings.length ||
    judgeVerdict.includes("WARNING") ||
    judgeVerdict === "NEEDS_FIXES"
  ) {
    finalVerdict = "PASS WITH WARNINGS";
  }

  let finalScore = rawJudgeScore;

  if (!rag.hasStreamingAssetsEvidence) {
    finalScore = Math.min(
      finalScore,
      59
    );
  }

  if (
    !deterministic.pass ||
    [
      "FAIL",
      "REJECT",
      "UNPARSEABLE"
    ].includes(judgeVerdict)
  ) {
    finalScore = Math.min(
      finalScore,
      49
    );
  }

  const streamingReferences = rag.files
    .filter(
      (file) => file.inStreamingAssets
    )
    .map((file) => file.rel);

  const codeReferences = rag.files
    .filter((file) => file.isCSharp)
    .map((file) => file.rel);

  const evidence = Array.isArray(
    judge?.evidence
  )
    ? judge.evidence.map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return `${
          item.file || "Project reference"
        }: ${
          item.finding ||
          JSON.stringify(item)
        }`;
      })
    : [];

  return [
    `VERDICT: ${finalVerdict}`,
    `Final score: ${finalScore}/100`,
    `Raw LLM judge score: ${rawJudgeScore}/100`,
    `Model: ${provider} / ${model}`,

    ...(!deterministic.pass
      ? [
          "Deterministic checks overrode any conflicting LLM verdict."
        ]
      : []),

    "",
    "DETERMINISTIC ERRORS",
    list(deterministic.errors),

    "",
    "DETERMINISTIC WARNINGS",
    list(deterministic.warnings),

    "",
    "RAG STATUS",
    `- Indexed project files: ${rag.indexedFileCount}`,
    `- Actual StreamingAssets files indexed: ${rag.streamingAssetsFileCount}`,
    `- StreamingAssets evidence included in this judgment: ${
      rag.hasStreamingAssetsEvidence
        ? "Yes"
        : "No"
    }`,

    "",
    "STREAMINGASSETS REFERENCES READ",
    list(streamingReferences),

    "",
    "PROJECT C# REFERENCES READ",
    list(codeReferences),

    "",
    "JUDGE SUMMARY",
    judge?.summary ||
      "No summary returned.",

    "",
    "COMPATIBILITY EVIDENCE",
    list(evidence),

    "",
    "LIKELY COMPILE ISSUES",
    list(judge?.compileIssues),

    "",
    "PROJECT COMPATIBILITY ISSUES",
    list(judge?.compatibilityIssues),

    "",
    "UNITY SETUP",
    list(judge?.unitySetup),

    "",
    "RECOMMENDED FIXES",
    list(judge?.fixes),

    "",
    "TEST PLAN",
    list(judge?.testPlan),

    "",
    "Note: this is a grounded static review. Only a real Unity compile and Play Mode test can prove runtime success."
  ].join("\n");
}
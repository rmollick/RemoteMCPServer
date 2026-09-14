export const ROOM_CONSTRAINTS = {
  RoomMedExam_base: {
    Bed: [1, 2, 3],
    Wall: [1, 2, 3],
    BedsideHead: [1, 2],
    BedsideMid: [1, 2],
    BedsideFoot: [1, 2],
    Cart: [1, 2],
    Screen: [1, 2, 3, 4]
  },

  RoomLrgPatient_base: {
    Bed: [1, 2, 3, 4],
    Wall: [1, 2, 3, 4],
    BedsideHead: [1, 2, 3, 4],
    BedsideMid: [1, 2, 3, 4],
    BedsideFoot: [1, 2, 3, 4],
    Cart: [1, 2, 3, 4],
    Screen: [1, 2, 3, 4, 5, 6, 7, 8]
  },

  RoomXLGPatient_base: {
    Bed: [1, 2, 3, 4, 5, 6],
    Wall: [1, 2, 3, 4, 5, 6],
    BedsideHead: [1, 2, 3, 4, 5, 6],
    BedsideHeadLeft: [1, 2, 3, 4, 5, 6],
    BedsideMid: [1, 2, 3, 4, 5, 6],
    BedsideFoot: [1, 2, 3, 4, 5, 6],
    Desk: [1, 2, 3, 4, 5, 6, 7, 8],
    Cart: [1, 2, 3, 4, 5, 6, 7],
    Bin: [1, 2, 3, 4, 5, 6],
    Screen: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    Chair: [1, 2],
    Nurse: [1, 2]
  },

  RoomMedOffice_base: {
    Desk: [1],
    Chair: [1]
  },

  RoomSmlStorage_base: {
    Bin: [1],
    Cart: [1],
    Desk: [1],
    Cabinet: [1, 2, 3, 4],
    Wall: [1, 2, 3, 4]
  },

  RoomLrgDoubleWard_base01: {
    Bed: [1, 2, 3, 4, 5],
    Wall: [1, 2, 3, 4, 5],
    BedsideHead: [1, 2, 3, 4, 5],
    BedsideHeadLeft: [1, 2, 3, 4, 5],
    BedsideMid: [1, 2, 3, 4, 5],
    BedsideFoot: [1, 2, 3, 4, 5],
    Desk: [1, 2, 3, 4, 5, 6, 7],
    Cart: [1, 2, 3, 4, 5],
    Bin: [1, 2, 3, 4, 5],
    Nurse: [1, 2, 3, 4, 5]
  },

  RoomLrgDoubleWard_base02: {
    Bed: [1, 2, 3, 4, 5],
    Wall: [1, 2, 3, 4, 5],
    BedsideHead: [1, 2, 3, 4, 5],
    BedsideHeadLeft: [1, 2, 3, 4, 5],
    BedsideMid: [1, 2, 3, 4, 5],
    BedsideFoot: [1, 2, 3, 4, 5],
    Desk: [1, 2, 3, 4, 5, 6, 7],
    Cart: [1, 2, 3, 4, 5],
    Bin: [1, 2, 3, 4, 5],
    Nurse: [1, 2, 3, 4, 5]
  },

  RoomLrgDoubleWard_base03: {
    Bed: [1, 2, 3, 4, 5],
    Wall: [1, 2, 3, 4, 5],
    BedsideHead: [1, 2, 3, 4, 5],
    BedsideHeadLeft: [1, 2, 3, 4, 5],
    BedsideMid: [1, 2, 3, 4, 5],
    BedsideFoot: [1, 2, 3, 4, 5],
    Desk: [1, 2, 3, 4, 5, 6, 7],
    Cart: [1, 2, 3, 4, 5],
    Bin: [1, 2, 3, 4, 5],
    Nurse: [1, 2, 3, 4, 5]
  }
};

export const PARENT_ASSETS = {
  Bed: ["ExaminationBed01", "OperatingTable01", "PatientBed01", "PatientBedClickable01", "Placeholder"],
  Wall: ["BathroomMirror01", "NoSmokingSign01", "NoticeBoard01", "Poster01", "Poster02", "Poster03", "Poster04", "Poster05", "Poster06", "Poster07", "XRayViewBox01", "XRayViewBox02", "Placeholder"],
  BedsideHead: ["GenAnaesthesiaMachine01", "RackInfusionBag01", "RackInfusionBag02", "RackInfusionBag03", "RackInfusionBottle01", "RackInfusionBottle02", "InfusionStandScene06", "InfusionStandScene07", "InfusionStandScene07B", "Placeholder"],
  BedsideHeadLeft: ["GenAnaesthesiaMachine01", "RackInfusionBag01", "RackInfusionBag02", "RackInfusionBag03", "RackInfusionBottle01", "RackInfusionBottle02", "MonitorOnStand01", "MonitorStand02", "Placeholder"],
  BedsideMid: ["RackInfusionBag01", "RackInfusionBag02", "RackInfusionBag03", "RackInfusionBottle01", "RackInfusionBottle02", "BloodBox02", "Placeholder"],
  BedsideFoot: ["RackInfusionBag01", "RackInfusionBag02", "RackInfusionBag03", "RackInfusionBottle01", "RackInfusionBottle02", "BloodBox02", "Placeholder"],
  Cart: ["COW00", "COW01", "Trolley01", "Trolley02", "Trolley03", "BloodBox02", "Placeholder"],
  Bin: ["BloodBox02", "Wastebin01", "WastebinScene06", "Placeholder"],
  Screen: ["PrivacyScreen01", "PrivacyScreen02", "Placeholder"],
  Desk: ["DeskSet01", "DeskSet02", "Table01", "TableScene03", "Table02Scene03", "Placeholder"],
  Chair: ["ChairArms01", "ChairNoArms01", "ChairOffice01", "Placeholder"],
  Nurse: ["NurseClickable01", "Placeholder"],
  Cabinet: ["CounterCabinet01", "Refrigerator01", "Refrigerator02", "RefrigeratorScene03", "RefrigeratorGlass01", "StandingShelf01", "StandingShelfBins01", "Placeholder"]
};

export const CHILD_SLOTS = {
  RackInfusionBag01: { InfusionBag: [1] },
  RackInfusionBag02: { InfusionBag: [1] },
  RackInfusionBottle01: { InfusionBottle: [1, 2], InfusionBottleLiquid: [1, 2] },
  RackInfusionBottle02: { InfusionBottle: [1, 2], InfusionBottleLiquid: [1, 2] },
  DeskSet01: { Computer: [1], Phone: [2], Document: [3, 4] },
  DeskSet02: { Computer: [1], Phone: [2], Document: [3, 4, 5, 6] },
  ExaminationBed01: { Patient: [1, 2] },
  OperatingTable01: { Patient: [1, 2] },
  PatientBed01: { Patient: [1, 2] },
  PatientBedClickable01: { Patient: [1, 2] },
  Table01: { Computer: [1], Document: [2, 3, 4] },
  COW00: { Computer: [1], Misc: [2, 3, 4, 5, 6, 7, 8, 9] },
  COW01: { Computer: [1], Misc: [2, 3, 4, 5, 6, 7, 8, 9] },
  MonitorStand02: { Computer: [1] },
  InfusionStandScene06: { InfusionBag: [1], IV: [2, 3, 4] },
  InfusionStandScene07: { InfusionBag: [1], IV: [2, 3, 4] },
  InfusionStandScene07B: { InfusionBag: [1], IV: [2, 3, 4] },
  RefrigeratorScene03: { Misc: [1, 2] },
  TableScene03: { Document: [1, 2, 3, 4, 6], Computer: [5], Phone: [7], Misc: [8] },
  Table02Scene03: { Document: [1, 2, 3, 4, 6], Computer: [5], Phone: [7], Misc: [8] },
  Table03: { Document: [1, 2, 3, 4] },
  StandingShelfBins01: { Misc: [1, 2, 3] },
  StandingShelf01: { Misc: [1, 2, 3] },
  CounterCabinet01: { Misc: [1, 2, 3, 4] }
};

export const CHILD_PREFABS = {
  InfusionBag: ["InfusionBag01", "InfusionBag02", "InfusionBag03", "InfusionBag04", "InfusionBag05", "BloodBagScene06", "InfusionSet"],
  InfusionBottle: ["InfusionBottle01", "InfusionBottle02", "InfusionBottle03", "InfusionBottle04"],
  InfusionBottleLiquid: ["InfusionBottleLiquid01", "InfusionBottleLiquid02", "InfusionBottleLiquid03"],
  Computer: ["ComputerSet01", "ComputerSetCLMM01", "ComputerSetCOW01", "VitalsMonitor01", "Placeholder"],
  Phone: ["Telephone01", "Placeholder"],
  Document: ["DocGXMForm", "DocConsentForm", "DocForms", "PaperScene03", "IDLabel01", "BloodBox02", "BloodBoxScene03", "Placeholder"],
  Patient: ["PatientTemp", "PatientOldMan01", "PatientOldMan02", "Placeholder"],
  Misc: ["DocGXMForm", "DocConsentForm", "IDLabel01", "IDLabel02", "InfusionBag01", "InfusionBag02", "InfusionBag03", "InfusionBag04", "InfusionBag05", "BloodBagScene06", "InfusionClamp01", "InfusionSet", "InfusionSet_ForTransfusion", "InfusionSet_InfusomatSpaceline", "InfusionSet_PrimeLine", "IVSet01", "KidneyDish01", "KidneyDish02", "LiquidSoap01", "Gloves01", "FoldedBloodPressureCuff01", "IcePack01", "IcePackScene03", "BloodBox02", "BloodBoxScene03", "TapeRoll01", "TestTubeBlood01", "Placeholder"],
  IV: ["Cannula01", "CannulaScene07", "InfusionClamp01", "InfusionClamp02", "IVLINE01", "IVLINE02", "Placeholder"]
};

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};

const REQUEST_TERMS = {
  Bed: "beds?",
  Wall: "walls?",
  BedsideHead: "bedside\\s*heads?",
  BedsideHeadLeft: "bedside\\s*head\\s*left",
  BedsideMid: "bedside\\s*mids?",
  BedsideFoot: "bedside\\s*foots?",
  Desk: "desks?",
  Cart: "carts?",
  Bin: "bins?",
  Screen: "screens?",
  Chair: "chairs?",
  Nurse: "nurse(?:\\s*stations?|\\s*desks?|\\s*clickable|\\s*slots?|s\\b)?",
  Cabinet: "cabinets?"
};

function parseCount(raw) {
  const value = String(raw || "").toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "a" || value === "an") return 1;
  return NUMBER_WORDS[value] || null;
}

function explicitCountFor(prompt, termPattern) {
  const countPattern = "(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const re = new RegExp(`\\b${countPattern}\\s+${termPattern}\\b`, "i");
  const match = String(prompt || "").match(re);
  return match ? parseCount(match[1]) : null;
}

function slotIndicesFor(prompt, termPattern) {
  const re = new RegExp(`\\b${termPattern}\\s*\\(?\\s*(?:slots?\\s*)?([\\d,\\s]+)\\)?`, "i");
  const match = String(prompt || "").match(re);
  if (match) {
    const nums = match[1].match(/\d+/g);
    if (nums && nums.length > 0) {
      return { count: nums.length, maxSlot: Math.max(...nums.map(Number)) };
    }
  }
  return null;
}

function isLocationNegated(prompt, termPattern) {
  const re = new RegExp(`\\b(?:no|not|without|never|don't|dont|do\\s+not|avoid|excluding|except)\\s+(?:any\\s+)?(?:other\\s+)?(?:[a-zA-Z0-9_-]+\\s+){0,2}${termPattern}\\b`, "i");
  return re.test(prompt);
}

function isLocationPlacementRequested(prompt, location, termPattern) {
  const text = String(prompt || "");

  // If negated, it's explicitly NOT being requested
  if (isLocationNegated(text, termPattern)) {
    return false;
  }

  if (location === "Nurse") {
    // In clinical simulations, "nurse" is frequently a narrative actor:
    // e.g. "nurse movement", "nurse enters", "nurse assessment", "nurse explains", "for nurse movement"
    // In LevelGen, "Nurse" is strictly a furniture slot for static NurseClickable01 props.
    // It is only a LevelGen placement request if it explicitly references the slot/prop:
    if (/NurseClickable/i.test(text)) return true;
    if (/\bnurse\s*(?:station|desk|slot|prop|object|asset)s?\b/i.test(text)) return true;
    if (/\bNurse\s*(?:\(?\s*\d+|\s*#\d+)/i.test(text)) return true;
    if (/\b(?:place|add|include|put|spawn|furnish with)\s+(?:a|an|\d+|one|two)?\s*(?:clickable\s+)?nurse\s*(?:station|desk|slot|prop|asset)?\b/i.test(text)) {
      if (/\b(?:for|during|after)\s+nurse\s+movement\b/i.test(text)) return false;
      return true;
    }
    return false;
  }

  // Check explicit slot numbers e.g. "Bed (1, 2, 3)" or "Desk 1"
  if (slotIndicesFor(text, termPattern) !== null) {
    return true;
  }

  // Check explicit count e.g. "1 desk", "two chairs", "a screen"
  if (explicitCountFor(text, termPattern) !== null) {
    return true;
  }

  // Check placement verbs e.g. "place Bed", "add Screen", "with desk"
  const placementVerbPattern = new RegExp(`\\b(?:place|add|include|put|spawn|furnish with|install|with)\\s+(?:a|an|the|\\d+|one|two|three|four)?\\s*${termPattern}\\b`, "i");
  if (placementVerbPattern.test(text)) {
    return true;
  }

  // Check if any named parent asset of this location is mentioned
  const assets = PARENT_ASSETS[location] || [];
  for (const asset of assets) {
    if (asset !== "Placeholder" && new RegExp(`\\b${asset}\\b`, "i").test(text)) {
      return true;
    }
  }

  return false;
}

export function guardLevelGenPrompt(rawPrompt, roomName) {
  const prompt = String(rawPrompt || "");
  const problems = [];
  const roomRules = ROOM_CONSTRAINTS[roomName];

  if (!roomRules) {
    return [`Unsupported room: ${roomName}. Choose a room that has hard constraints configured.`];
  }

  for (const [location, termPattern] of Object.entries(REQUEST_TERMS)) {
    if (!isLocationPlacementRequested(prompt, location, termPattern)) {
      continue;
    }

    const available = roomRules[location] || [];
    if (available.length === 0) {
      problems.push(`${roomName} does not support the ${location} location.`);
      continue;
    }

    const slots = slotIndicesFor(prompt, termPattern);
    const count = explicitCountFor(prompt, termPattern);
    const requestedCount = slots ? Math.max(slots.count, slots.maxSlot) : (count !== null ? count : 1);

    if (requestedCount > available.length) {
      problems.push(`${roomName} supports only ${available.length} ${location} slot(s), but ${requestedCount} were requested.`);
    }
  }

  const allNamedAssets = [...new Set(Object.values(PARENT_ASSETS).flat())].filter((x) => x !== "Placeholder");
  for (const asset of allNamedAssets) {
    if (!prompt.toLowerCase().includes(asset.toLowerCase())) continue;

    for (const location of Object.keys(PARENT_ASSETS)) {
      const pairPattern = new RegExp(`${asset}\\s+(?:on|at|in)\\s+(?:the\\s+)?${location}(?:\\s+\\d+)?`, "i");
      if (!pairPattern.test(prompt)) continue;

      if (!PARENT_ASSETS[location].includes(asset)) {
        problems.push(`${asset} cannot be placed in ${location}; it belongs to a different parent category.`);
      }
    }
  }

  return [...new Set(problems)];
}

export function validateLevelGen(script, expectedRoomName = null) {
  const errors = [];
  const warnings = [];

  const lines = String(script || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { pass: false, errors: ["Generated file is empty."], warnings };
  }

  if (String(script).includes("```")) {
    errors.push("Generated file contains markdown code fences.");
  }

  const roomRows = lines.filter((line) => line.split("\t")[0] === "Room");
  if (roomRows.length !== 1) {
    errors.push(`Expected exactly one Room row, found ${roomRows.length}.`);
  }

  const firstParts = lines[0].split("\t");
  if (firstParts.length !== 3 || firstParts[0] !== "Room" || firstParts[1] !== "0") {
    errors.push("First row must be exactly: Room<TAB>0<TAB><RoomSceneName>.");
    return { pass: false, errors, warnings };
  }

  const roomName = firstParts[2];
  if (expectedRoomName && roomName !== expectedRoomName) {
    errors.push(`Generated room is ${roomName}, but the selected room is ${expectedRoomName}.`);
  }

  const roomRules = ROOM_CONSTRAINTS[roomName];
  if (!roomRules) {
    errors.push(`No hard constraints are configured for room ${roomName}.`);
    return { pass: false, errors, warnings };
  }

  const usedParentSlots = new Set();

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];

    if (!line.includes("\t")) {
      errors.push(`Line ${lineNumber} is not tab-separated: ${line}`);
      continue;
    }

    const parts = line.split("\t").map((p) => p.trim());
    if (parts.length < 3) {
      errors.push(`Line ${lineNumber} has fewer than 3 columns: ${line}`);
      continue;
    }

    if ((parts.length - 3) % 3 !== 0) {
      errors.push(`Line ${lineNumber} has incomplete child triples: ${line}`);
      continue;
    }

    const location = parts[0];
    const slotNumber = Number(parts[1]);
    const parentPrefab = parts[2];

    if (!roomRules[location]) {
      errors.push(`Line ${lineNumber}: ${location} is not available in ${roomName}.`);
      continue;
    }

    if (!Number.isInteger(slotNumber) || !roomRules[location].includes(slotNumber)) {
      errors.push(`Line ${lineNumber}: ${location} ${parts[1]} is not a valid slot in ${roomName}.`);
    }

    const parentKey = `${location}:${slotNumber}`;
    if (usedParentSlots.has(parentKey)) {
      errors.push(`Line ${lineNumber}: duplicate parent slot ${location} ${slotNumber}.`);
    }
    usedParentSlots.add(parentKey);

    const allowedParents = PARENT_ASSETS[location] || [];
    if (!allowedParents.includes(parentPrefab)) {
      errors.push(`Line ${lineNumber}: ${parentPrefab} is not a valid ${location} parent prefab.`);
    }

    const childRules = CHILD_SLOTS[parentPrefab] || {};
    const usedChildSlots = new Set();

    for (let p = 3; p < parts.length; p += 3) {
      const childCategory = parts[p];
      const childSlot = Number(parts[p + 1]);
      const childPrefab = parts[p + 2];

      const allowedSlots = childRules[childCategory] || [];
      if (!allowedSlots.includes(childSlot)) {
        errors.push(`Line ${lineNumber}: ${parentPrefab} does not support ${childCategory} slot ${parts[p + 1]}.`);
      }

      const childKey = `${childCategory}:${childSlot}`;
      if (usedChildSlots.has(childKey)) {
        errors.push(`Line ${lineNumber}: duplicate child slot ${childCategory} ${childSlot}.`);
      }
      usedChildSlots.add(childKey);

      const allowedChildPrefabs = CHILD_PREFABS[childCategory] || [];
      if (!allowedChildPrefabs.includes(childPrefab)) {
        errors.push(`Line ${lineNumber}: ${childPrefab} is not a valid prefab for child category ${childCategory}.`);
      }
    }
  }

  return {
    pass: errors.length === 0,
    roomName,
    errors,
    warnings
  };
}
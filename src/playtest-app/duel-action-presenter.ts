import type { CardPosition, DuelAction, DuelPhase, PublicDuelCard } from "#duel/types.js";

export type DuelActionTone =
  | "attack"
  | "chain"
  | "effect"
  | "phase"
  | "prompt"
  | "set"
  | "summon"
  | "turn";

export interface DuelActionPresentation {
  title: string;
  detail: string;
  badge: string;
  tone: DuelActionTone;
}

export interface DuelActionPresentationOptions {
  card?: PublicDuelCard;
  cardVisible?: boolean;
  cardsByUid?: ReadonlyMap<string, PublicDuelCard>;
}

const rawLuaSuffixPattern = /\s*:\s*lua-\d+(?:-\d+)*\b.*$/;
const selectOptionLabelPattern = /^select option\s+(-?\d+)(?:\s+\(.+\))?$/i;

export function duelActionPresentation(
  action: DuelAction,
  options: DuelActionPresentationOptions = {},
): DuelActionPresentation {
  const cardName = displayCardName(options.card, options.cardVisible);

  switch (action.type) {
    case "normalSummon":
      return {
        title: "Normal Summon",
        detail: `Choose a Monster Zone, then place ${cardName} face-up in Attack Position.`,
        badge: "Summon",
        tone: "summon",
      };
    case "tributeSummon":
      return {
        title: "Tribute Summon",
        detail: `Release ${cardList(action.tributeUids, options.cardsByUid, "monster")}, then choose a Monster Zone.`,
        badge: "Summon",
        tone: "summon",
      };
    case "tributeSet":
      return {
        title: "Tribute Set",
        detail: `Release ${cardList(action.tributeUids, options.cardsByUid, "monster")}, then set ${cardName} face-down.`,
        badge: "Set",
        tone: "set",
      };
    case "fusionSummon":
      return materialSummonPresentation("Fusion Summon", action.materialUids, options.cardsByUid);
    case "synchroSummon":
      return materialSummonPresentation("Synchro Summon", action.materialUids, options.cardsByUid);
    case "xyzSummon":
      return materialSummonPresentation("Xyz Summon", action.materialUids, options.cardsByUid);
    case "linkSummon":
      return materialSummonPresentation("Link Summon", action.materialUids, options.cardsByUid);
    case "ritualSummon":
      return materialSummonPresentation("Ritual Summon", action.materialUids, options.cardsByUid);
    case "pendulumSummon":
      return {
        title: "Pendulum Summon",
        detail: `Special Summon ${cardList(action.summonUids, options.cardsByUid, "monster")}.`,
        badge: "Summon",
        tone: "summon",
      };
    case "setMonster":
      return {
        title: "Set monster",
        detail: `Choose a Monster Zone, then place ${cardName} face-down in Defense Position.`,
        badge: "Set",
        tone: "set",
      };
    case "setSpellTrap":
      return {
        title: "Set face-down",
        detail: `Choose a Spell & Trap Zone, then place ${cardName} face-down.`,
        badge: "Set",
        tone: "set",
      };
    case "activateEffect":
      return activateEffectPresentation(action, options.card, cardName);
    case "specialSummonProcedure":
      return {
        title: "Special Summon",
        detail: `Use this card's summon procedure, then choose a Monster Zone for ${cardName}.`,
        badge: "Summon",
        tone: "summon",
      };
    case "passChain":
      return {
        title: "Pass response",
        detail: "Take no Chain action now. If both players pass, the Chain resolves.",
        badge: "Chain",
        tone: "chain",
      };
    case "passAttack":
      return {
        title: "Pass attack response",
        detail: "Take no action during this attack window.",
        badge: "Battle",
        tone: "attack",
      };
    case "passDamage":
      return {
        title: "Pass damage response",
        detail: "Take no action during this Damage Step window.",
        badge: "Damage",
        tone: "attack",
      };
    case "replayAttack":
      return {
        title: action.directAttack ? "Attack directly" : "Choose attack target",
        detail: action.directAttack
          ? "Continue the replay as a direct attack."
          : `Continue the replay against ${uidName(action.targetUid, options.cardsByUid, "this target")}.`,
        badge: "Replay",
        tone: "attack",
      };
    case "cancelAttack":
      return {
        title: "Cancel attack",
        detail: "Stop this attack instead of choosing a replay target.",
        badge: "Replay",
        tone: "attack",
      };
    case "selectOption":
      return {
        title: selectOptionTitle(action),
        detail: "Choose this option for the current effect prompt.",
        badge: "Prompt",
        tone: "prompt",
      };
    case "selectYesNo":
      return {
        title: action.yes ? "Yes" : "No",
        detail: action.yes ? "Confirm the current effect prompt." : "Decline the current effect prompt.",
        badge: "Prompt",
        tone: "prompt",
      };
    case "activateTrigger":
      return {
        title: "Activate triggered effect",
        detail: `Start a Chain with ${cardName}'s triggered effect.`,
        badge: "Trigger",
        tone: "effect",
      };
    case "declineTrigger":
      return {
        title: "Do not activate",
        detail: `Skip ${cardName}'s optional triggered effect for this window.`,
        badge: "Trigger",
        tone: "chain",
      };
    case "flipSummon":
      return {
        title: "Flip Summon",
        detail: `Turn ${cardName} face-up in Attack Position.`,
        badge: "Summon",
        tone: "summon",
      };
    case "changePosition":
      return {
        title: "Change battle position",
        detail: `Change ${cardName} to ${positionLabel(action.position)}.`,
        badge: "Position",
        tone: "summon",
      };
    case "declareAttack":
      return {
        title: action.directAttack ? "Direct attack" : "Attack monster",
        detail: action.directAttack
          ? "Declare a direct attack with this monster."
          : `Declare an attack on ${uidName(action.targetUid, options.cardsByUid, "the selected monster")}.`,
        badge: "Battle",
        tone: "attack",
      };
    case "changePhase":
      return {
        title: `Go to ${phaseLabel(action.phase)}`,
        detail: `Move the duel to ${phaseLabel(action.phase)}.`,
        badge: "Phase",
        tone: "phase",
      };
    case "endTurn":
      return {
        title: "End turn",
        detail: "Pass turn priority to the opponent.",
        badge: "Turn",
        tone: "turn",
      };
  }

  const exhaustive: never = action;
  return {
    title: cleanedDuelActionLabel(exhaustive),
    detail: "Resolve this legal action.",
    badge: "Action",
    tone: "turn",
  };
}

export function cleanedDuelActionLabel(
  action: DuelAction,
  options: DuelActionPresentationOptions = {},
): string {
  let label = action.label;
  if (options.card && options.cardVisible === false) label = label.replaceAll(options.card.name, "hidden card");
  label = label.replace(rawLuaSuffixPattern, "").trim();
  label = label.replace(/\s*\(\s*lua-\d+(?:-\d+)*\s*\)\s*/g, " ").trim();
  return label || duelActionPresentation(action, options).title;
}

export function duelActionPlacementInstruction(
  action: DuelAction,
  location: "monsterZone" | "spellTrapZone",
  options: DuelActionPresentationOptions = {},
): { title: string; detail: string } {
  const presentation = duelActionPresentation(action, options);
  const zone = location === "monsterZone" ? "Monster Zone" : "Spell & Trap Zone";
  return {
    title: presentation.title,
    detail: `Choose an open ${zone}. Press Escape or Cancel to back out.`,
  };
}

function activateEffectPresentation(
  action: Extract<DuelAction, { type: "activateEffect" }>,
  card: PublicDuelCard | undefined,
  cardName: string,
): DuelActionPresentation {
  if (card?.kind === "spell" || card?.kind === "trap") {
    const fromHand = card.location === "hand";
    const cardKind = card.kind === "spell" ? "Spell" : "Trap";
    return {
      title: fromHand ? "Activate card" : "Activate effect",
      detail: fromHand
        ? `Choose a zone, then activate this ${cardKind} as Chain Link 1.`
        : `Start a Chain with ${cardName}'s effect.`,
      badge: fromHand ? `Play ${cardKind}` : "Effect",
      tone: "effect",
    };
  }

  return {
    title: "Activate effect",
    detail: `Start a Chain with ${cardName}'s effect.`,
    badge: action.windowKind === "chainResponse" ? "Quick Effect" : "Effect",
    tone: "effect",
  };
}

function materialSummonPresentation(
  title: string,
  materialUids: readonly string[],
  cardsByUid: ReadonlyMap<string, PublicDuelCard> | undefined,
): DuelActionPresentation {
  return {
    title,
    detail: `Use ${cardList(materialUids, cardsByUid, "material")} as ${plural("material", materialUids.length)}, then choose a Monster Zone.`,
    badge: "Summon",
    tone: "summon",
  };
}

function selectOptionTitle(action: Extract<DuelAction, { type: "selectOption" }>): string {
  const cleaned = cleanedRawLabel(action.label);
  const match = selectOptionLabelPattern.exec(cleaned);
  if (!match) return cleaned;
  return `Option ${match[1]}`;
}

function cleanedRawLabel(label: string): string {
  return label
    .replace(rawLuaSuffixPattern, "")
    .replace(/\s*\(.+\)\s*$/, "")
    .trim();
}

function displayCardName(card: PublicDuelCard | undefined, cardVisible: boolean | undefined): string {
  if (!card) return "this card";
  return cardVisible === false ? "this hidden card" : card.name;
}

function cardList(
  uids: readonly string[],
  cardsByUid: ReadonlyMap<string, PublicDuelCard> | undefined,
  fallbackKind: string,
): string {
  const names = uids.flatMap((uid) => {
    const card = cardsByUid?.get(uid);
    return card ? [card.name] : [];
  });
  if (names.length !== uids.length || names.length === 0) return `${uids.length} ${plural(fallbackKind, uids.length)}`;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function uidName(
  uid: string | undefined,
  cardsByUid: ReadonlyMap<string, PublicDuelCard> | undefined,
  fallback: string,
): string {
  if (uid === undefined) return fallback;
  return cardsByUid?.get(uid)?.name ?? fallback;
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function phaseLabel(phase: DuelPhase): string {
  switch (phase) {
    case "draw":
      return "Draw Phase";
    case "standby":
      return "Standby Phase";
    case "main1":
      return "Main Phase 1";
    case "battle":
      return "Battle Phase";
    case "main2":
      return "Main Phase 2";
    case "end":
      return "End Phase";
  }
}

function positionLabel(position: CardPosition): string {
  switch (position) {
    case "faceDown":
      return "face-down";
    case "faceDownDefense":
      return "face-down Defense Position";
    case "faceUpAttack":
      return "face-up Attack Position";
    case "faceUpDefense":
      return "face-up Defense Position";
  }
}

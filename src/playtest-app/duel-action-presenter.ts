import type { CardPosition, DuelAction, DuelPhase, PublicDuelCard } from "#duel/types.js";
import type { LuaPromptResumeValue } from "#lua/host-types.js";
import type { DuelPromptChoice } from "./duel-prompt-view.js";

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
  card?: PublicDuelCard | undefined;
  cardVisible?: boolean | undefined;
  cardsByUid?: ReadonlyMap<string, PublicDuelCard> | undefined;
  cardsByCode?: ReadonlyMap<string, PublicDuelCard> | undefined;
}

export interface DuelPromptChoicePresentationOptions extends DuelActionPresentationOptions {
  luaPromptApi?: string | undefined;
  revealedCardUids?: ReadonlySet<string> | undefined;
  visibleCardUids?: ReadonlySet<string> | undefined;
}

interface DuelDescriptionTextOptions extends DuelActionPresentationOptions {
  sourceCard?: PublicDuelCard | undefined;
  allowCardNameFallback?: boolean | undefined;
}

const rawLuaSuffixPattern = /\s*:\s*lua-\d+(?:-\d+)*\b.*$/;
const selectOptionLabelPattern = /^select option\s+(-?\d+)(?:\s+\(.+\))?$/i;

export function duelActionPresentation(
  action: DuelAction,
  options: DuelActionPresentationOptions = {},
): DuelActionPresentation {
  const sourceCard = options.card ?? duelActionSourceCard(action, options.cardsByUid);
  const cardName = displayCardName(sourceCard, options.cardVisible);

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
      return activateEffectPresentation(action, sourceCard, cardName, options);
    case "specialSummonProcedure":
      return specialSummonProcedurePresentation(action, sourceCard, cardName, options);
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
      return triggerEffectPresentation(action, sourceCard, cardName, options, true);
    case "declineTrigger":
      return triggerEffectPresentation(action, sourceCard, cardName, options, false);
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
  const sourceCard = options.card ?? duelActionSourceCard(action, options.cardsByUid);
  const effectText = effectTextForAction(action, sourceCard, options);
  if (isEffectAction(action) && sourceCard && effectText && options.cardVisible !== false) {
    return `${sourceCard.name}: ${summarizeEffectText(effectText)}`;
  }
  let label = action.label;
  if (sourceCard && options.cardVisible === false) label = label.replaceAll(sourceCard.name, "hidden card");
  label = label.replace(rawLuaSuffixPattern, "").trim();
  label = label.replace(/\s*\(\s*lua-\d+(?:-\d+)*\s*\)\s*/g, " ").trim();
  return label || duelActionPresentation(action, options).title;
}

export function duelActionSourceCard(
  action: DuelAction,
  cardsByUid: ReadonlyMap<string, PublicDuelCard> | undefined,
): PublicDuelCard | undefined {
  if (cardsByUid === undefined) return undefined;
  if ("uid" in action) return cardsByUid.get(action.uid);
  if ("attackerUid" in action) return cardsByUid.get(action.attackerUid);
  return undefined;
}

export function duelPromptChoicePresentation(
  choice: DuelPromptChoice,
  options: DuelPromptChoicePresentationOptions = {},
): DuelActionPresentation {
  const choiceText = promptChoiceText(choice, options);
  if (choice.type === "selectYesNo") {
    return {
      title: choice.yes ? (choiceText ? `Yes - ${summarizeEffectText(choiceText)}` : "Yes") : "No",
      detail: choice.yes
        ? (choiceText ? `Confirm or activate: ${choiceText}` : "Confirm the current effect prompt.")
        : (choiceText ? `Decline: ${choiceText}` : "Decline the current effect prompt."),
      badge: choice.yes ? "Confirm" : "Decline",
      tone: "prompt",
    };
  }

  const fallback = duelActionPresentation(choice.action, options);
  if (!choiceText) return fallback;
  return {
    title: summarizeEffectText(choiceText),
    detail: promptChoiceDetail(choice, choiceText, options.luaPromptApi),
    badge: promptChoiceBadge(options.luaPromptApi),
    tone: "prompt",
  };
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
  options: DuelActionPresentationOptions,
): DuelActionPresentation {
  const effectText = effectTextForAction(action, card, options);
  const title = effectActionTitle(cardName, effectText, action.label);
  if (card?.kind === "spell" || card?.kind === "trap") {
    const fromHand = card.location === "hand";
    const cardKind = card.kind === "spell" ? "Spell" : "Trap";
    return {
      title,
      detail: fromHand
        ? `Choose a zone, then activate this ${cardKind}.${effectText ? ` Effect: ${effectText}` : ""}`
        : `${action.windowKind === "chainResponse" ? "Respond to the current Chain" : "Start a Chain"} with ${cardName}.${effectText ? ` Effect: ${effectText}` : ""}`,
      badge: fromHand ? `Play ${cardKind}` : action.windowKind === "chainResponse" ? "Quick Effect" : "Effect",
      tone: "effect",
    };
  }

  return {
    title,
    detail: `${action.windowKind === "chainResponse" ? "Respond to the current Chain" : "Start a Chain"} with ${cardName}.${effectText ? ` Effect: ${effectText}` : ""}`,
    badge: action.windowKind === "chainResponse" ? "Quick Effect" : "Effect",
    tone: "effect",
  };
}

function specialSummonProcedurePresentation(
  action: Extract<DuelAction, { type: "specialSummonProcedure" }>,
  card: PublicDuelCard | undefined,
  cardName: string,
  options: DuelActionPresentationOptions,
): DuelActionPresentation {
  const effectText = effectTextForAction(action, card, options);
  return {
    title: effectText ? `${cardName}: ${summarizeEffectText(effectText)}` : `Special Summon ${cardName}`,
    detail: `Use ${cardName}'s summon procedure, then choose a Monster Zone.${effectText ? ` Procedure: ${effectText}` : ""}`,
    badge: "Summon",
    tone: "summon",
  };
}

function triggerEffectPresentation(
  action: Extract<DuelAction, { type: "activateTrigger" | "declineTrigger" }>,
  card: PublicDuelCard | undefined,
  cardName: string,
  options: DuelActionPresentationOptions,
  activate: boolean,
): DuelActionPresentation {
  const effectText = effectTextForAction(action, card, options);
  if (!activate) {
    return {
      title: effectText ? `Skip ${summarizeEffectText(effectText)}` : `Skip ${cardName}`,
      detail: `Do not activate ${cardName}'s optional triggered effect in this window.${effectText ? ` Effect: ${effectText}` : ""}`,
      badge: "Decline",
      tone: "chain",
    };
  }
  return {
    title: effectActionTitle(cardName, effectText, action.label),
    detail: `Start a Chain with ${cardName}'s triggered effect.${effectText ? ` Effect: ${effectText}` : ""}`,
    badge: "Trigger",
    tone: "effect",
  };
}

function isEffectAction(action: DuelAction): action is Extract<DuelAction, { type: "activateEffect" | "activateTrigger" | "declineTrigger" | "specialSummonProcedure" }> {
  return action.type === "activateEffect" ||
    action.type === "activateTrigger" ||
    action.type === "declineTrigger" ||
    action.type === "specialSummonProcedure";
}

function effectActionTitle(cardName: string, effectText: string | undefined, rawLabel: string): string {
  if (effectText) return `${cardName}: ${summarizeEffectText(effectText)}`;
  const labelText = readableEffectLabel(rawLabel, cardName);
  if (labelText) return `${cardName}: ${labelText}`;
  return `${cardName}: Effect`;
}

function effectTextForAction(
  action: DuelAction,
  sourceCard: PublicDuelCard | undefined,
  options: DuelActionPresentationOptions,
): string | undefined {
  if (!isEffectAction(action)) return undefined;
  const descriptionText = duelDescriptionText(action.effectDescription, { ...options, sourceCard, allowCardNameFallback: false });
  if (descriptionText && !isGenericEffectText(descriptionText)) return descriptionText;
  const labelText = readableEffectLabel(action.label, sourceCard?.name);
  if (labelText) return labelText;
  const cardText = sourceCard?.description?.trim();
  if (cardText && !isGenericEffectText(cardText)) return cardText;
  return descriptionText;
}

export function duelDescriptionText(
  description: number | undefined,
  options: DuelDescriptionTextOptions = {},
): string | undefined {
  if (description === undefined || !Number.isFinite(description)) return undefined;
  const code = Math.floor(description / 16);
  const index = description - code * 16;
  if (index >= 0 && index <= 15) {
    const sourceMatch = options.sourceCard?.code === String(code) ? options.sourceCard : undefined;
    const stringCard = sourceMatch ?? cardByCode(String(code), options);
    const text = stringCard?.effectTexts?.[index]?.trim();
    if (text) return text;
  }
  if (options.allowCardNameFallback === false) return undefined;
  return cardByCode(String(description), options)?.name;
}

function cardByCode(
  code: string,
  options: Pick<DuelActionPresentationOptions, "cardsByCode" | "cardsByUid">,
): PublicDuelCard | undefined {
  const direct = options.cardsByCode?.get(code);
  if (direct) return direct;
  return [...(options.cardsByUid?.values() ?? [])].find((card) => card.code === code);
}

function promptChoiceText(choice: DuelPromptChoice, options: DuelPromptChoicePresentationOptions): string | undefined {
  if (choice.type === "selectYesNo") {
    return duelDescriptionText(choice.description, options);
  }
  const returnValueText = promptReturnValueText(choice.luaReturnValues, options);
  if (returnValueText) return returnValueText;
  if (choice.descriptionList?.length) {
    const labels = choice.descriptionList.map((description) => promptDescriptionText(description, options)).filter((label): label is string => Boolean(label));
    if (labels.length) return labels.join(" + ");
  }
  if (choice.description !== undefined) {
    const label = promptDescriptionText(choice.description, options);
    if (label) return label;
  }
  const returnCode = choice.luaReturnValues?.find(isLuaPromptCardCodeValue)?.code;
  if (returnCode !== undefined) return cardByCode(String(returnCode), options)?.name;
  const cleaned = cleanedRawLabel(choice.action.label);
  return selectOptionLabelPattern.test(cleaned) ? undefined : cleaned;
}

function isLuaPromptCardCodeValue(value: LuaPromptResumeValue): value is Extract<LuaPromptResumeValue, { code: number }> {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "number";
}

function promptReturnValueText(values: readonly LuaPromptResumeValue[] | undefined, options: DuelPromptChoicePresentationOptions): string | undefined {
  if (!values?.length) return undefined;
  for (const value of values) {
    if (typeof value !== "object" || value === null) continue;
    if ("uids" in value) return promptUidListText(value.uids, options, " + ");
    if ("sortDeck" in value) return promptUidListText(value.sortDeck.uids, options, " > ");
  }
  return undefined;
}

function promptUidListText(uids: readonly string[], options: DuelPromptChoicePresentationOptions, separator: string): string | undefined {
  const labels = uids.map((uid) => promptUidName(uid, options)).filter((label): label is string => Boolean(label));
  return labels.length ? labels.join(separator) : undefined;
}

function promptUidName(uid: string, options: DuelPromptChoicePresentationOptions): string | undefined {
  const card = options.cardsByUid?.get(uid);
  if (!card) return undefined;
  const visible = options.visibleCardUids?.has(uid) || options.revealedCardUids?.has(uid);
  return displayCardName(card, visible);
}

function promptDescriptionText(description: number, options: DuelPromptChoicePresentationOptions): string | undefined {
  const decoded = duelDescriptionText(description, options);
  if (decoded) return decoded;
  switch (options.luaPromptApi) {
    case "AnnounceAttribute":
      return attributeLabel(description);
    case "AnnounceRace":
      return raceLabel(description);
    case "AnnounceType":
      return cardTypeFlagLabel(description);
    case "AnnounceLevel":
      return `Level ${description}`;
    case "AnnounceNumber":
    case "AnnounceNumberRange":
      return String(description);
    default:
      return undefined;
  }
}

function promptChoiceDetail(choice: Extract<DuelPromptChoice, { type: "selectOption" }>, choiceText: string, luaPromptApi: string | undefined): string {
  switch (luaPromptApi) {
    case "SelectEffect":
      return `Apply this effect: ${choiceText}`;
    case "SelectCard":
      return `Choose ${choiceText} for the resolving effect.`;
    case "SortDecktop":
      return `Put the cards on top of the Deck in this order: ${choiceText}.`;
    case "SortDeckbottom":
      return `Put the cards on bottom of the Deck in this order: ${choiceText}.`;
    case "SelectCardsFromCodes":
      return `Choose ${choiceText} for the resolving effect.`;
    case "AnnounceCard":
      return `Declare ${choiceText}.`;
    case "AnnounceAttribute":
    case "AnnounceRace":
    case "AnnounceType":
    case "AnnounceLevel":
    case "AnnounceNumber":
    case "AnnounceNumberRange":
      return `Choose ${choiceText}.`;
    default:
      return `Choose option ${choice.option}: ${choiceText}`;
  }
}

function promptChoiceBadge(luaPromptApi: string | undefined): string {
  switch (luaPromptApi) {
    case "SelectEffect":
      return "Effect";
    case "SelectCard":
    case "SelectCardsFromCodes":
      return "Card";
    case "SortDecktop":
      return "Top Deck";
    case "SortDeckbottom":
      return "Bottom Deck";
    case "SelectDisableField":
    case "SelectField":
    case "SelectFieldZone":
      return "Zone";
    case "AnnounceCard":
    case "AnnounceAttribute":
    case "AnnounceRace":
    case "AnnounceLevel":
    case "AnnounceNumber":
    case "AnnounceNumberRange":
    case "AnnounceType":
      return "Declare";
    default:
      return "Option";
  }
}

function summarizeEffectText(text: string): string {
  const compact = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  const firstSentence = compact.match(/^.{1,96}?(?:[.;]|$)/u)?.[0]?.trim() ?? compact;
  const summary = firstSentence.length >= 18 ? firstSentence : compact;
  return summary.length > 96 ? `${summary.slice(0, 93).trim()}...` : summary;
}

function readableEffectLabel(label: string, cardName: string | undefined): string | undefined {
  const cleaned = cleanedRawLabel(label);
  if (cardName && cleaned === cardName) return undefined;
  const withoutCard = cardName && cleaned.startsWith(`${cardName}:`) ? cleaned.slice(cardName.length + 1).trim() : cleaned;
  if (!withoutCard || isRawEffectIdentifier(withoutCard)) return undefined;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(withoutCard)) return humanizeEffectSlug(withoutCard);
  return withoutCard;
}

function humanizeEffectSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRawEffectIdentifier(value: string): boolean {
  return /^lua-\d+(?:-\d+)*$/i.test(value) ||
    /^[a-z]+-\d+(?:-\d+)*$/i.test(value) ||
    /^effect\s*\d*$/i.test(value);
}

function isGenericEffectText(value: string): boolean {
  return /^activate effect\??$/i.test(value.trim()) || /^activate \d+ of these effects/i.test(value.trim());
}

function attributeLabel(value: number): string | undefined {
  return new Map<number, string>([
    [1, "EARTH"],
    [2, "WATER"],
    [4, "FIRE"],
    [8, "WIND"],
    [16, "LIGHT"],
    [32, "DARK"],
    [64, "DIVINE"],
  ]).get(value);
}

function raceLabel(value: number): string | undefined {
  return new Map<number, string>([
    [1, "Warrior"],
    [2, "Spellcaster"],
    [4, "Fairy"],
    [8, "Fiend"],
    [16, "Zombie"],
    [32, "Machine"],
    [64, "Aqua"],
    [128, "Pyro"],
    [256, "Rock"],
    [512, "Winged Beast"],
    [1024, "Plant"],
    [2048, "Insect"],
    [4096, "Thunder"],
    [8192, "Dragon"],
    [16384, "Beast"],
    [32768, "Beast-Warrior"],
    [65536, "Dinosaur"],
    [131072, "Fish"],
    [262144, "Sea Serpent"],
    [524288, "Reptile"],
    [1048576, "Psychic"],
    [2097152, "Divine-Beast"],
    [4194304, "Creator God"],
    [8388608, "Wyrm"],
    [16777216, "Cyberse"],
    [33554432, "Illusion"],
  ]).get(value);
}

function cardTypeFlagLabel(value: number): string | undefined {
  const labels: string[] = [];
  if ((value & 0x1) !== 0) labels.push("Monster");
  if ((value & 0x2) !== 0) labels.push("Spell");
  if ((value & 0x4) !== 0) labels.push("Trap");
  if ((value & 0x10) !== 0) labels.push("Normal");
  if ((value & 0x20) !== 0) labels.push("Effect");
  if ((value & 0x40) !== 0) labels.push("Fusion");
  if ((value & 0x80) !== 0) labels.push("Ritual");
  if ((value & 0x2000) !== 0) labels.push("Synchro");
  if ((value & 0x400000) !== 0) labels.push("Tuner");
  if ((value & 0x800000) !== 0) labels.push("Xyz");
  if ((value & 0x1000000) !== 0) labels.push("Pendulum");
  if ((value & 0x4000000) !== 0) labels.push("Link");
  if ((value & 0x10000) !== 0) labels.push("Quick-Play");
  if ((value & 0x20000) !== 0) labels.push("Continuous");
  if ((value & 0x40000) !== 0) labels.push("Equip");
  if ((value & 0x80000) !== 0) labels.push("Field");
  if ((value & 0x100000) !== 0) labels.push("Counter");
  return labels.length ? labels.join(" / ") : undefined;
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

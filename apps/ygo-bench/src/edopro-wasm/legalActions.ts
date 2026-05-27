import type { CardDatabase } from "./cardDb.js";
import type { OcgMessage, OcgRuntime } from "./ocgTypes.js";

export interface RealLegalAction {
  id: string;
  type: string;
  label: string;
  response: unknown;
}

export function buildRealLegalActions(prompt: OcgMessage | undefined, ocg: OcgRuntime, cardDb: CardDatabase): RealLegalAction[] {
  if (!prompt) return [];

  if (prompt.type === ocg.OcgMessageType.SELECT_IDLECMD) {
    const actions: RealLegalAction[] = [];
    const summons = arrayOfRecords(prompt.summons);
    const monsterSets = arrayOfRecords(prompt.monster_sets);
    const activates = arrayOfRecords(prompt.activates);

    for (const [index, card] of summons.entries()) {
      actions.push({
        id: nextActionId(actions.length),
        type: "normal_summon",
        label: `Normal Summon ${cardName(card.code, cardDb)}`,
        response: { type: ocg.OcgResponseType.SELECT_IDLECMD, action: ocg.SelectIdleCMDAction.SELECT_SUMMON, index },
      });
    }
    for (const [index, card] of monsterSets.entries()) {
      actions.push({
        id: nextActionId(actions.length),
        type: "set_monster",
        label: `Set ${cardName(card.code, cardDb)}`,
        response: { type: ocg.OcgResponseType.SELECT_IDLECMD, action: ocg.SelectIdleCMDAction.SELECT_MONSTER_SET, index },
      });
    }
    for (const [index, card] of activates.entries()) {
      actions.push({
        id: nextActionId(actions.length),
        type: "activate_effect",
        label: `Activate ${cardName(card.code, cardDb)}`,
        response: { type: ocg.OcgResponseType.SELECT_IDLECMD, action: ocg.SelectIdleCMDAction.SELECT_ACTIVATE, index },
      });
    }
    if (prompt.to_bp === true) {
      actions.push({
        id: nextActionId(actions.length),
        type: "to_battle",
        label: "Go to Battle Phase",
        response: { type: ocg.OcgResponseType.SELECT_IDLECMD, action: ocg.SelectIdleCMDAction.TO_BP, index: null },
      });
    }
    if (prompt.to_ep === true) {
      actions.push({
        id: nextActionId(actions.length),
        type: "end_phase",
        label: "End Phase",
        response: { type: ocg.OcgResponseType.SELECT_IDLECMD, action: ocg.SelectIdleCMDAction.TO_EP, index: null },
      });
    }
    return actions;
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_CHAIN) {
    const actions: RealLegalAction[] = arrayOfRecords(prompt.selects).map((card, index) => ({
      id: nextActionId(index),
      type: "respond",
      label: `Chain ${cardName(card.code, cardDb)}`,
      response: { type: ocg.OcgResponseType.SELECT_CHAIN, index },
    }));
    if (prompt.forced !== true) {
      actions.push({
        id: nextActionId(actions.length),
        type: "decline_chain",
        label: "Do not respond",
        response: { type: ocg.OcgResponseType.SELECT_CHAIN, index: null },
      });
    }
    return actions;
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_BATTLECMD) {
    const actions: RealLegalAction[] = [];
    const chains = arrayOfRecords(prompt.chains);
    const attacks = arrayOfRecords(prompt.attacks);

    for (const [index, card] of chains.entries()) {
      actions.push({
        id: nextActionId(actions.length),
        type: "activate_effect",
        label: `Activate ${cardName(card.code, cardDb)}`,
        response: { type: ocg.OcgResponseType.SELECT_BATTLECMD, action: ocg.SelectBattleCMDAction.SELECT_CHAIN, index },
      });
    }
    for (const [index, card] of attacks.entries()) {
      actions.push({
        id: nextActionId(actions.length),
        type: "attack",
        label: `Attack with ${cardName(card.code, cardDb)}`,
        response: { type: ocg.OcgResponseType.SELECT_BATTLECMD, action: ocg.SelectBattleCMDAction.SELECT_BATTLE, index },
      });
    }
    if (prompt.to_m2 === true) {
      actions.push({
        id: nextActionId(actions.length),
        type: "to_main2",
        label: "Go to Main Phase 2",
        response: { type: ocg.OcgResponseType.SELECT_BATTLECMD, action: ocg.SelectBattleCMDAction.TO_M2, index: null },
      });
    }
    if (prompt.to_ep === true) {
      actions.push({
        id: nextActionId(actions.length),
        type: "end_phase",
        label: "End Phase",
        response: { type: ocg.OcgResponseType.SELECT_BATTLECMD, action: ocg.SelectBattleCMDAction.TO_EP, index: null },
      });
    }
    return actions;
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_PLACE) {
    const count = typeof prompt.count === "number" ? prompt.count : 1;
    const mask = typeof prompt.field_mask === "number" ? prompt.field_mask : 0xffffffff;
    const places = firstOpenMonsterZones(mask, typeof prompt.player === "number" ? prompt.player : 0, count);
    return places.map((place, index) => ({
      id: nextActionId(index),
      type: "select_place",
      label: `Place card in monster zone ${place.sequence + 1}`,
      response: { type: ocg.OcgResponseType.SELECT_PLACE, places: [place] },
    }));
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_CARD) {
    const selects = arrayOfRecords(prompt.selects);
    const canCancel = prompt.can_cancel === true;
    const actions: RealLegalAction[] = selects.map((card, index) => ({
      id: nextActionId(index),
      type: "select_card",
      label: `Select ${cardName(card.code, cardDb)}`,
      response: { type: ocg.OcgResponseType.SELECT_CARD, indicies: [index] },
    }));
    if (canCancel) {
      actions.push({
        id: nextActionId(actions.length),
        type: "cancel",
        label: "Cancel selection",
        response: { type: ocg.OcgResponseType.SELECT_CARD, indicies: null },
      });
    }
    return actions;
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_YESNO) {
    const cardLabel = typeof prompt.code === "number" ? ` for ${cardName(prompt.code, cardDb)}` : "";
    return [
      {
        id: "a_001",
        type: "yes",
        label: `Yes${cardLabel}`,
        response: { type: ocg.OcgResponseType.SELECT_YESNO, yes: true },
      },
      {
        id: "a_002",
        type: "no",
        label: `No${cardLabel}`,
        response: { type: ocg.OcgResponseType.SELECT_YESNO, yes: false },
      },
    ];
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_OPTION) {
    return arrayOfUnknown(prompt.options).map((option, index) => ({
      id: nextActionId(index),
      type: "select_option",
      label: optionLabel(option, index, cardDb),
      response: { type: ocg.OcgResponseType.SELECT_OPTION, index },
    }));
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_POSITION) {
    const code = typeof prompt.code === "number" ? prompt.code : undefined;
    const positions = positionChoices(prompt.positions, ocg);
    return positions.map((position, index) => ({
      id: nextActionId(index),
      type: "select_position",
      label: `${positionLabel(position, ocg)}${code ? ` ${cardName(code, cardDb)}` : ""}`,
      response: { type: ocg.OcgResponseType.SELECT_POSITION, position },
    }));
  }

  return [];
}

function firstOpenMonsterZones(fieldMask: number, player: number, count: number): Array<{ player: number; location: number; sequence: number }> {
  const places: Array<{ player: number; location: number; sequence: number }> = [];
  for (let sequence = 0; sequence < 5 && places.length < count; sequence += 1) {
    if ((fieldMask & (1 << sequence)) === 0) {
      places.push({ player, location: 4, sequence });
    }
  }
  return places;
}

function nextActionId(index: number): string {
  return `a_${String(index + 1).padStart(3, "0")}`;
}

function cardName(code: unknown, cardDb: CardDatabase): string {
  return typeof code === "number" ? (cardDb.names.get(code) ?? `#${code}`) : "unknown card";
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
}

function arrayOfUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionLabel(option: unknown, index: number, cardDb: CardDatabase): string {
  if (typeof option === "string") return option;
  if (typeof option === "number") return cardDb.names.get(option) ?? `Option ${index + 1}: ${option}`;
  if (typeof option === "bigint") return `Option ${index + 1}: ${option.toString()}`;
  if (typeof option === "object" && option !== null && "code" in option) {
    const code = (option as { code?: unknown }).code;
    return `Select ${cardName(code, cardDb)}`;
  }
  return `Option ${index + 1}`;
}

function positionChoices(value: unknown, ocg: OcgRuntime): number[] {
  if (Array.isArray(value)) return value.filter((position): position is number => typeof position === "number");
  if (typeof value === "number") {
    const choices = [
      ocg.OcgPosition.FACEUP_ATTACK,
      ocg.OcgPosition.FACEDOWN_ATTACK,
      ocg.OcgPosition.FACEUP_DEFENSE,
      ocg.OcgPosition.FACEDOWN_DEFENSE,
    ].filter((position): position is number => typeof position === "number");
    return choices.filter((position) => (value & position) !== 0);
  }
  return [];
}

function positionLabel(position: number, ocg: OcgRuntime): string {
  if (position === ocg.OcgPosition.FACEUP_ATTACK) return "Face-up attack";
  if (position === ocg.OcgPosition.FACEDOWN_ATTACK) return "Face-down attack";
  if (position === ocg.OcgPosition.FACEUP_DEFENSE) return "Face-up defense";
  if (position === ocg.OcgPosition.FACEDOWN_DEFENSE) return "Face-down defense";
  return `Position ${position}`;
}

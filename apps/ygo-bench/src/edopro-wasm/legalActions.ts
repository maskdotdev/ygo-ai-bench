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

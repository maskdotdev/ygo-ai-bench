import { describe, expect, it } from "vitest";
import { buildRealLegalActions } from "./legalActions.js";
import type { CardDatabase } from "./cardDb.js";
import type { OcgRuntime } from "./ocgTypes.js";

describe("buildRealLegalActions", () => {
  it("maps SELECT_IDLECMD options to stable model-facing action ids with hidden responses", () => {
    const actions = buildRealLegalActions(
      {
        type: 11,
        player: 0,
        summons: [{ code: 49003308, controller: 0, location: 2, sequence: 1 }],
        monster_sets: [{ code: 49003308, controller: 0, location: 2, sequence: 1 }],
        activates: [],
        to_bp: false,
        to_ep: true,
      },
      testRuntime,
      testCards,
    );

    expect(actions.map((action) => ({ id: action.id, type: action.type, label: action.label }))).toEqual([
      { id: "a_001", type: "normal_summon", label: "Normal Summon Gagagigo" },
      { id: "a_002", type: "set_monster", label: "Set Gagagigo" },
      { id: "a_003", type: "end_phase", label: "End Phase" },
    ]);
    expect(actions[0]?.response).toEqual({ type: 1, action: 0, index: 0 });
  });

  it("maps SELECT_PLACE to a concrete zone response", () => {
    const actions = buildRealLegalActions(
      { type: 18, player: 1, count: 1, field_mask: 0xffffffe0 },
      testRuntime,
      testCards,
    );

    expect(actions).toEqual([
      {
        id: "a_001",
        type: "select_place",
        label: "Place card in monster zone 1",
        response: { type: 10, places: [{ player: 1, location: 4, sequence: 0 }] },
      },
    ]);
  });
});

const testCards: CardDatabase = {
  cards: new Map(),
  names: new Map([[49003308, "Gagagigo"]]),
};

const testRuntime = {
  OcgMessageType: {
    SELECT_IDLECMD: 11,
    SELECT_CHAIN: 16,
    SELECT_PLACE: 18,
  },
  OcgResponseType: {
    SELECT_IDLECMD: 1,
    SELECT_CHAIN: 8,
    SELECT_PLACE: 10,
  },
  SelectIdleCMDAction: {
    SELECT_SUMMON: 0,
    SELECT_MONSTER_SET: 3,
    SELECT_ACTIVATE: 5,
    TO_BP: 6,
    TO_EP: 7,
  },
} as OcgRuntime;

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

  it("maps SELECT_BATTLECMD to attack and phase actions", () => {
    const actions = buildRealLegalActions(
      {
        type: 10,
        player: 0,
        chains: [],
        attacks: [{ code: 49003308, controller: 0, location: 4, sequence: 0 }],
        to_m2: true,
        to_ep: true,
      },
      testRuntime,
      testCards,
    );

    expect(actions).toEqual([
      {
        id: "a_001",
        type: "attack",
        label: "Attack with Gagagigo",
        response: { type: 0, action: 1, index: 0 },
      },
      {
        id: "a_002",
        type: "to_main2",
        label: "Go to Main Phase 2",
        response: { type: 0, action: 2, index: null },
      },
      {
        id: "a_003",
        type: "end_phase",
        label: "End Phase",
        response: { type: 0, action: 3, index: null },
      },
    ]);
  });

  it("maps SELECT_CARD to card choices and cancel", () => {
    const actions = buildRealLegalActions(
      {
        type: 15,
        player: 1,
        can_cancel: true,
        min: 1,
        max: 1,
        selects: [{ code: 49003308, controller: 0, location: 4, sequence: 0, position: 1 }],
      },
      testRuntime,
      testCards,
    );

    expect(actions).toEqual([
      {
        id: "a_001",
        type: "select_card",
        label: "Select Gagagigo",
        response: { type: 5, indicies: [0] },
      },
      {
        id: "a_002",
        type: "cancel",
        label: "Cancel selection",
        response: { type: 5, indicies: null },
      },
    ]);
  });

  it("maps SELECT_YESNO to explicit yes and no actions", () => {
    const actions = buildRealLegalActions({ type: 13, player: 0, code: 49003308 }, testRuntime, testCards);

    expect(actions).toEqual([
      {
        id: "a_001",
        type: "yes",
        label: "Yes for Gagagigo",
        response: { type: 3, yes: true },
      },
      {
        id: "a_002",
        type: "no",
        label: "No for Gagagigo",
        response: { type: 3, yes: false },
      },
    ]);
  });

  it("maps SELECT_OPTION to stable option actions", () => {
    const actions = buildRealLegalActions({ type: 14, player: 0, options: [49003308, "Draw card"] }, testRuntime, testCards);

    expect(actions).toEqual([
      {
        id: "a_001",
        type: "select_option",
        label: "Gagagigo",
        response: { type: 4, index: 0 },
      },
      {
        id: "a_002",
        type: "select_option",
        label: "Draw card",
        response: { type: 4, index: 1 },
      },
    ]);
  });

  it("maps SELECT_POSITION bitmask to position actions", () => {
    const actions = buildRealLegalActions({ type: 19, player: 0, code: 49003308, positions: 5 }, testRuntime, testCards);

    expect(actions).toEqual([
      {
        id: "a_001",
        type: "select_position",
        label: "Face-up attack Gagagigo",
        response: { type: 11, position: 1 },
      },
      {
        id: "a_002",
        type: "select_position",
        label: "Face-up defense Gagagigo",
        response: { type: 11, position: 4 },
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
    SELECT_BATTLECMD: 10,
    SELECT_CARD: 15,
    SELECT_CHAIN: 16,
    SELECT_PLACE: 18,
    SELECT_YESNO: 13,
    SELECT_OPTION: 14,
    SELECT_POSITION: 19,
  },
  OcgResponseType: {
    SELECT_IDLECMD: 1,
    SELECT_BATTLECMD: 0,
    SELECT_CARD: 5,
    SELECT_CHAIN: 8,
    SELECT_PLACE: 10,
    SELECT_YESNO: 3,
    SELECT_OPTION: 4,
    SELECT_POSITION: 11,
  },
  OcgPosition: {
    FACEUP_ATTACK: 1,
    FACEDOWN_ATTACK: 2,
    FACEUP_DEFENSE: 4,
    FACEDOWN_DEFENSE: 8,
  },
  SelectIdleCMDAction: {
    SELECT_SUMMON: 0,
    SELECT_MONSTER_SET: 3,
    SELECT_ACTIVATE: 5,
    TO_BP: 6,
    TO_EP: 7,
  },
  SelectBattleCMDAction: {
    SELECT_CHAIN: 0,
    SELECT_BATTLE: 1,
    TO_M2: 2,
    TO_EP: 3,
  },
} as OcgRuntime;

import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { groupDuelLegalActions } from "#duel/legal-action-groups.js";
import { getPromptResponseActions, stampDuelActions } from "#duel/prompt-response.js";
import { createCardReader } from "#engine/data-loaders.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "../src/playtest-app/duel-battlefield-actions.js";
import { runDuelBattlefieldScript, type DuelBattlefieldScriptRuntime } from "../src/playtest-app/duel-battlefield-script.js";
import { cards } from "./full-duel-engine-fixtures.js";
import type { DuelAction, DuelSession, PlayerId, PublicChainLink } from "#duel/types.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";

describe("duel battlefield action view", () => {
  it("drives a direct battle fixture through visible battlefield actions", () => {
    const session = createDuel({ seed: 991, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    specialSummonDuelCard(session.state, attacker!.uid, 0);

    const battle = visibleAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toMatchObject({ type: "changePhase", phase: "battle", windowKind: "open" });
    applyVisible(session, battle);

    const attackView = visibleView(session, 0);
    expect(attackView.byUid.get(attacker!.uid)).toContainEqual(expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid }));
    const attack = visibleDuelBattlefieldActions(attackView).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.directAttack === true,
    );
    expect(attack).toBeDefined();
    applyVisible(session, attack!);

    const opponentPass = visibleAction(session, 1, (action) => action.type === "passAttack");
    expect(visibleView(session, 1).orphanGroups).toContainEqual(expect.objectContaining({ label: "Pass", actions: [opponentPass] }));
    applyVisible(session, opponentPass);

    passVisibleBattleWindows(session);

    const state = queryPublicState(session);
    expect(state.players[1].lifePoints).toBe(6200);
    expect(state.attacksDeclared).toContain(attacker!.uid);
  });

  it("runs fixture-style scripts through the visible battlefield action surface", () => {
    const session = directBattleSession();
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "100");
    expect(attacker).toBeDefined();

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", labelIncludes: "battle" },
      { player: 0, type: "declareAttack", uid: attacker!.uid },
      { player: 1, type: "passAttack", groupLabel: "Attack Response" },
      { player: 0, type: "passAttack", groupLabel: "Attack Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.players[1].lifePoints).toBe(6200);
    expect(result.state.attacksDeclared).toContain(attacker!.uid);
  });

  it("matches visible scripts by exact window and action fields", () => {
    const session = directBattleSession();
    const battle = visibleAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    const windowId = battle.windowId;
    const windowToken = battle.windowToken;
    if (windowId === undefined || windowToken === undefined) throw new Error("Expected visible battle action to be stamped with a window");

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", phase: "battle", windowId, windowKind: "open", windowToken },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("battle");
  });

  it("matches prompt responses by exact prompt id and option", () => {
    const session = directBattleSession();
    session.state.prompt = { id: "battlefield-option-prompt", type: "selectOption", player: 1, options: [2, 4], descriptions: [200, 400], returnTo: 0 };
    session.state.waitingFor = 1;
    const option = getDuelLegalActions(session, 1).find((action) => action.type === "selectOption" && action.promptId === "battlefield-option-prompt" && action.option === 4);
    expect(option).toBeDefined();

    const result = runDuelBattlefieldScript(session, [
      { player: 1, type: "selectOption", promptId: "battlefield-option-prompt", option: 4, windowId: option!.windowId, windowKind: "prompt", windowToken: option!.windowToken },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.prompt).toBeUndefined();
    expect(result.state.waitingFor).toBe(0);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "selectOption", detail: "Selected option 4" }));
  });

  it("matches prompt responses by structured description metadata", () => {
    const session = directBattleSession();
    session.state.prompt = {
      id: "battlefield-description-prompt",
      type: "selectOption",
      player: 1,
      options: [1, 2],
      descriptions: [300, 400],
      descriptionLists: [[301], [401, 402]],
      returnTo: 0,
    };
    session.state.waitingFor = 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 1, type: "selectOption", promptDescription: 400, promptDescriptionList: [402, 401], windowKind: "prompt" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.prompt).toBeUndefined();
    expect(result.state.waitingFor).toBe(0);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "selectOption", detail: "Selected option 2" }));
  });

  it("matches Lua option prompt responses by ordered resume values", () => {
    const session = directBattleSession();
    session.state.prompt = {
      id: "battlefield-return-values-prompt",
      type: "selectOption",
      player: 1,
      options: [1, 2, 3],
      descriptions: [700, 800, 900],
      descriptionLists: [[700, 800], [800, 900], [700, 900]],
      returnTo: 0,
      origin: "luaOperation",
    };
    session.state.luaOperationPrompt = {
      chainLink: testLuaPromptChainLink(),
      prompt: {
        id: "battlefield-return-values-prompt",
        api: "SelectCardsFromCodes",
        player: 1,
        options: [1, 2, 3],
        descriptions: [700, 800, 900],
        descriptionLists: [[700, 800], [800, 900], [700, 900]],
        returned: 1,
        returnValues: [
          [{ code: 700, index: 1 }, { code: 800, index: 2 }],
          [{ code: 800, index: 2 }, { code: 900, index: 3 }],
          [{ code: 700, index: 1 }, { code: 900, index: 3 }],
        ],
      },
    };
    session.state.waitingFor = 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 1, type: "selectOption", luaPromptApi: "SelectCardsFromCodes", promptReturnValues: [{ code: 800, index: 2 }, { code: 900, index: 3 }], windowKind: "prompt" },
    ], luaPromptSelectorRuntime());

    expect(result.ok).toBe(true);
    expect(result.state.prompt).toBeUndefined();
    expect(result.state.luaOperationPrompt).toBeUndefined();
    expect(result.state.waitingFor).toBe(0);
  });

  it("reports trigger-order prompts when visible scripts diverge", () => {
    const session = createDuel({ seed: 997, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    registerEffect(session, {
      id: "battlefield-first-mandatory",
      sourceUid: first!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation() {},
    });
    registerEffect(session, {
      id: "battlefield-second-mandatory",
      sourceUid: second!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation() {},
    });
    applyVisible(session, visibleAction(session, 0, (action) => action.type === "normalSummon" && action.uid === summoned!.uid));

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "endTurn" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.triggerOrder).toMatchObject({
      label: "Trigger Order",
      detail: "P1 · turnMandatory · 2 triggers",
    });
    expect(result.triggerOrder?.groups.flatMap((group) => group.actions).map((action) => (
      action.type === "activateTrigger" ? action.effectId : action.type
    ))).toEqual(["battlefield-first-mandatory", "battlefield-second-mandatory"]);
  });

  it("matches visible summon scripts by exact material selection", () => {
    const session = createDuel({ seed: 992, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(fusion).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", uid: fusion!.uid, materialUids: [second!.uid, first!.uid] },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(result.state.cards.find((card) => card.uid === first!.uid)).toMatchObject({ location: "graveyard" });
    expect(result.state.cards.find((card) => card.uid === second!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("matches visible scripts by structured selection group kind", () => {
    const session = createDuel({ seed: 992, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(fusion).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", uid: fusion!.uid, materialUids: [first!.uid, second!.uid], groupSelectionKind: "material" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });

  it("reports material selector fields when visible summon scripts diverge", () => {
    const session = createDuel({ seed: 993, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(fusion).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", uid: fusion!.uid, materialUids: [first!.uid] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(0);
    expect(result.failure).toBe(`No visible battlefield action matched player=0 type=fusionSummon uid=${fusion!.uid} materialUids=${first!.uid}`);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "fusionSummon", uid: fusion!.uid, materialUids: expect.arrayContaining([first!.uid, second!.uid]) }));
  });

  it("deep-copies visible script selection arrays in result payloads", () => {
    const session = createDuel({ seed: 996, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);
    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", materialUids: [first!.uid] },
    ]);
    const leaked = result.visibleActions.find((action) => action.type === "fusionSummon");
    expect(leaked?.type).toBe("fusionSummon");
    if (!leaked || leaked.type !== "fusionSummon") throw new Error("Expected visible Fusion action");

    leaked.materialUids.push("mutated-material");
    const fresh = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", materialUids: [first!.uid] },
    ]);

    const freshFusion = fresh.visibleActions.find((action) => action.type === "fusionSummon");
    if (!freshFusion || freshFusion.type !== "fusionSummon") throw new Error("Expected fresh visible Fusion action");
    expect(freshFusion.materialUids).toHaveLength(2);
    expect(freshFusion.materialUids).toEqual(expect.arrayContaining([first!.uid, second!.uid]));
  });

  it("copies visible battlefield action arrays before browser renderers receive them", () => {
    const session = createDuel({ seed: 995, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);

    const sourceActions = getDuelLegalActions(session, 0);
    const sourceGroups = getGroupedDuelLegalActions(session, 0);
    const view = duelBattlefieldActionView(queryPublicState(session), 0, sourceActions, sourceGroups);
    const visibleFusion = visibleDuelBattlefieldActions(view).find((action) => action.type === "fusionSummon");
    const sourceFusion = sourceActions.find((action) => action.type === "fusionSummon");
    if (!visibleFusion || visibleFusion.type !== "fusionSummon") throw new Error("Expected visible Fusion action");
    if (!sourceFusion || sourceFusion.type !== "fusionSummon") throw new Error("Expected source Fusion action");

    visibleFusion.materialUids.push("mutated-material");

    expect(sourceFusion.materialUids).toHaveLength(2);
    expect(sourceFusion.materialUids).toEqual(expect.arrayContaining([first!.uid, second!.uid]));

    const passAction: DuelAction = { type: "passChain", player: 0, label: "Pass" };
    const passGroup: DuelLegalActionGroup = { key: "pass", label: "Pass", actions: [passAction] };
    const orphanView = duelBattlefieldActionView(queryPublicState(session), 0, [passAction], [passGroup]);
    const orphanAction = orphanView.orphanGroups[0]?.actions[0];
    expect(orphanAction).toBeDefined();
    orphanAction!.label = "Mutated group action";

    expect(passAction.label).toBe("Pass");
    expect(passGroup.actions[0]?.label).toBe("Pass");
  });

  it("matches visible summon scripts by exact tribute selection", () => {
    const session = createDuel({ seed: 994, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeDefined();
    expect(tribute).toBeDefined();
    specialSummonDuelCard(session.state, tribute!.uid, 0);

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "tributeSummon", uid: tributeMonster!.uid, tributeUids: [tribute!.uid] },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(result.state.cards.find((card) => card.uid === tribute!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("matches visible Pendulum scripts by selected summon subset", () => {
    const pendulumCards = [
      { code: "101", name: "Visible Low Scale", kind: "monster" as const, typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "Visible High Scale", kind: "monster" as const, typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "103", name: "Visible Pendulum Candidate", kind: "monster" as const, typeFlags: 0x1000001, level: 4 },
    ];
    const session = createDuel({ seed: 995, startingHandSize: 3, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["101", "102", "103"] },
      1: { main: [] },
    });
    startDuel(session);
    const low = session.state.cards.find((card) => card.code === "101");
    const high = session.state.cards.find((card) => card.code === "102");
    const candidate = session.state.cards.find((card) => card.code === "103");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, low!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, high!.uid, "spellTrapZone", 0).sequence = 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "pendulumSummon", summonUids: [candidate!.uid] },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ summonType: "pendulum" });
    expect(result.state.players[0].pendulumSummonAvailable).toBe(false);
  });

  it("reports prompt views when a visible prompt script diverges", () => {
    const session = directBattleSession();
    session.state.prompt = { id: "battlefield-diverge-prompt", type: "selectOption", player: 1, options: [2, 4], descriptions: [200, 400], returnTo: 0 };
    session.state.waitingFor = 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 1, type: "selectOption", promptId: "battlefield-diverge-prompt", option: 6, windowKind: "prompt" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.prompt).toMatchObject({ label: "Option Prompt", detail: "P2 · Prompt battlefield-diverge-prompt · returns P1 · options 2, 4 · text 200, 400" });
    expect(result.prompt?.choices).toMatchObject([
      { type: "selectOption", option: 2, description: 200, action: { type: "selectOption", option: 2 } },
      { type: "selectOption", option: 4, description: 400, action: { type: "selectOption", option: 4 } },
    ]);
    expect(result.prompt?.groups.flatMap((group) => group.actions)).toEqual(result.visibleActions);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "selectOption", promptId: "battlefield-diverge-prompt", option: 4 }));
  });

  it("reports visible group labels when a battlefield script diverges", () => {
    const session = directBattleSession();
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "100");
    expect(attacker).toBeDefined();

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", labelIncludes: "battle" },
      { player: 0, type: "declareAttack", uid: attacker!.uid },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(2);
    expect(result.failure).toBe("No visible battlefield action matched player=1 type=passDamage groupLabel=Damage Step Response");
    expect(result.visibleGroups).toContainEqual(expect.objectContaining({ label: "Attack Response" }));
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "passAttack" }));
  });

  it("reports visible group selection kind when a battlefield script diverges", () => {
    const session = directBattleSession();
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "100");
    expect(attacker).toBeDefined();

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", labelIncludes: "battle" },
      { player: 0, type: "declareAttack", uid: attacker!.uid },
      { player: 1, type: "passAttack", groupSelectionKind: "battleReplay" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(2);
    expect(result.failure).toBe("No visible battlefield action matched player=1 type=passAttack groupSelectionKind=battleReplay");
    const responseGroup = result.visibleGroups.find((group) => group.label === "Attack Response");
    expect(responseGroup).toBeDefined();
    expect(responseGroup?.selectionKind).toBeUndefined();
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "passAttack" }));
  });

  it("reports exact selector fields when a visible script diverges", () => {
    const session = directBattleSession();
    const battle = visibleAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    const wrongWindowId = (battle.windowId ?? 0) + 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", phase: "battle", windowId: wrongWindowId, windowKind: "open", occurrence: 0 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(0);
    expect(result.failure).toBe(`No visible battlefield action matched player=0 type=changePhase windowId=${wrongWindowId} windowKind=open phase=battle occurrence=0`);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "changePhase", phase: "battle", windowId: battle.windowId, windowKind: "open" }));
    expect(result.visibleGroups).toContainEqual(expect.objectContaining({
      windowId: battle.windowId,
      windowKind: "open",
      windowToken: battle.windowToken,
      actions: expect.arrayContaining([
        expect.objectContaining({ type: "changePhase", phase: "battle", windowId: battle.windowId, windowKind: "open", windowToken: battle.windowToken }),
      ]),
    }));
  });
});

function directBattleSession(): DuelSession {
  const session = createDuel({ seed: 991, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["400"] },
  });
  startDuel(session);

  const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  expect(attacker).toBeDefined();
  specialSummonDuelCard(session.state, attacker!.uid, 0);
  return session;
}

function testLuaPromptChainLink(): PublicChainLink {
  return {
    id: "battlefield-lua-prompt-chain",
    player: 1,
    sourceUid: "battlefield-lua-prompt-source",
    effectId: "battlefield-lua-prompt-effect",
  };
}

function luaPromptSelectorRuntime(): DuelBattlefieldScriptRuntime {
  return {
    getLegalActions(session, player) {
      const prompt = session.state.prompt;
      if (!prompt) return [];
      return stampDuelActions(getPromptResponseActions(prompt, player), session.state.actionWindowId, "prompt", session.state.actionWindowToken);
    },
    getGroupedLegalActions(session, player) {
      return groupDuelLegalActions(this.getLegalActions(session, player));
    },
    applyResponse(session, action) {
      if (action.type !== "selectOption" || action.option !== 2) {
        return {
          ok: false,
          error: "Unexpected Lua prompt selector test action",
          state: queryPublicState(session),
          legalActions: this.getLegalActions(session, action.player),
          legalActionGroups: this.getGroupedLegalActions(session, action.player),
        };
      }
      delete session.state.prompt;
      delete session.state.luaOperationPrompt;
      session.state.waitingFor = 0;
      return {
        ok: true,
        state: queryPublicState(session),
        legalActions: this.getLegalActions(session, action.player),
        legalActionGroups: this.getGroupedLegalActions(session, action.player),
      };
    },
  };
}

function visibleView(session: DuelSession, player: PlayerId) {
  return duelBattlefieldActionView(
    queryPublicState(session),
    player,
    getDuelLegalActions(session, player),
    getGroupedDuelLegalActions(session, player),
  );
}

function visibleAction(session: DuelSession, player: PlayerId, predicate: (action: DuelAction) => boolean): DuelAction {
  const action = visibleDuelBattlefieldActions(visibleView(session, player)).find(predicate);
  expect(action).toBeDefined();
  return action!;
}

function applyVisible(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok).toBe(true);
}

function passVisibleBattleWindows(session: DuelSession): void {
  for (let i = 0; i < 12; i += 1) {
    const state = queryPublicState(session);
    if (state.players[1].lifePoints < 8000) return;
    const player = state.waitingFor;
    expect(player).toBeDefined();
    const view = visibleView(session, player!);
    const action = visibleDuelBattlefieldActions(view).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage");
    expect(action).toBeDefined();
    expect(view.orphanGroups.some((group) => group.actions.includes(action!))).toBe(true);
    applyVisible(session, action!);
  }
  expect(queryPublicState(session).players[1].lifePoints).toBeLessThan(8000);
}

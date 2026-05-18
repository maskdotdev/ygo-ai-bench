import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const omniWeaponCode = "45450218";
const hasOmniWeaponScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${omniWeaponCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasOmniWeaponScript)("Lua real script Ally of Justice Omni-Weapon battled label draw summon", () => {
  it("restores EVENT_BATTLED label state into the battle-destroyed draw and optional DARK Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lightTargetCode = "45450219";
    const darkDrawCode = "45450220";
    const script = workspace.readScript(`c${omniWeaponCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLED)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("e2:SetLabelObject(e1)");
    expect(script).toContain("tc:GetLevel()<=4 and tc:IsAttribute(ATTRIBUTE_DARK)");
    expect(script).toContain("Duel.GetOperatedGroup():GetFirst()");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      {
        code: omniWeaponCode,
        name: "Ally of Justice Omni-Weapon",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 5,
        attack: 2200,
        defense: 800,
        attribute: attributeDark,
      },
      {
        code: lightTargetCode,
        name: "Omni-Weapon LIGHT Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1000,
        defense: 1000,
        attribute: attributeLight,
      },
      {
        code: darkDrawCode,
        name: "Omni-Weapon Drawn DARK Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        level: 4,
        attack: 1200,
        defense: 1000,
        attribute: attributeDark,
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 45450218, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [omniWeaponCode, darkDrawCode] }, 1: { main: [lightTargetCode] } });
    startDuel(session);

    const omniWeapon = requireCard(session, omniWeaponCode);
    const lightTarget = requireCard(session, lightTargetCode);
    const darkDraw = requireCard(session, darkDrawCode);
    moveDuelCard(session.state, omniWeapon.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, lightTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(omniWeaponCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === omniWeapon.uid && action.targetUid === lightTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === lightTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: omniWeapon.uid,
    });
    expect(session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: omniWeapon.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [omniWeapon.uid, lightTarget.uid],
      },
    ]);
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-2-1140",
        eventCardUid: lightTarget.uid,
        eventCode: 1140,
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "battleDestroyed",
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: omniWeapon.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-7-1",
        player: 0,
        sourceUid: omniWeapon.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 1)).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === omniWeapon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
    ]));
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === omniWeapon.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === lightTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === darkDraw.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: omniWeapon.uid,
      reasonEffectId: 2,
    });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: lightTarget.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: omniWeapon.uid,
      },
    ]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => ["cardsDrawn", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: darkDraw.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: omniWeapon.uid,
        eventReasonEffectId: 2,
        eventUids: [darkDraw.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: darkDraw.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: omniWeapon.uid,
        eventReasonEffectId: 2,
        eventUids: [darkDraw.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const stateSummary = {
      player,
      battleStep: session.state.battleStep,
      battleWindow: session.state.battleWindow,
      pendingBattle: session.state.pendingBattle,
      currentAttack: session.state.currentAttack,
      lastEvent: session.state.eventHistory.at(-1),
      playerActions: getLegalActions(session, player),
    };
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(stateSummary, null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const ogreCode = "82670878";
const hasOgreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ogreCode}.lua`));
const attackerACode = "826708780";
const attackerBCode = "826708781";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasOgreScript)("Lua real script Ogre of the Scarlet Sorrow custom direct summon", () => {
  it("restores two direct-attack global checks into custom hand summon, final copied stats, and battle target lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ogreCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_CUSTOM+id)");
    expect(script).toContain("Duel.GetAttackTarget()==nil and s[tp]==2");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
    expect(script).toContain("ge1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("ge2:SetCode(EVENT_ATTACK_DISABLED)");
    expect(script).toContain("Duel.RaiseEvent(tc,EVENT_CUSTOM+id,e,0,0,0,0)");
    expect(script).toContain("aux.AddValuesReset(function()");

    const cards: DuelCardData[] = [
      { code: ogreCode, name: "Ogre of the Scarlet Sorrow", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 0, defense: 0 },
      { code: attackerACode, name: "Ogre Scarlet First Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1200 },
      { code: attackerBCode, name: "Ogre Scarlet Second Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 82670878, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ogreCode] }, 1: { main: [attackerACode, attackerBCode] } });
    startDuel(session);

    const ogre = requireCard(session, ogreCode);
    const attackerA = requireCard(session, attackerACode);
    const attackerB = requireCard(session, attackerBCode);
    moveDuelCard(session.state, ogre.uid, "hand", 0);
    moveFaceUpAttack(session, attackerA.uid, 1);
    moveFaceUpAttack(session, attackerB.uid, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ogreCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    declareDirectAttack(restoredOpen, attackerA.uid);
    passRestoredBattle(restoredOpen);
    expect(restoredOpen.session.state.flagEffects).toContainEqual(expect.objectContaining({ ownerType: "card", ownerId: attackerA.uid, code: Number(ogreCode) }));

    declareDirectAttack(restoredOpen, attackerB.uid);
    passRestoredBattleUntil(restoredOpen, () => restoredOpen.session.state.pendingTriggers.some((trigger) => trigger.effectId === `lua-1-${0x10000000 + Number(ogreCode)}`));
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: attackerB.uid,
        eventCode: 0x10000000 + Number(ogreCode),
        eventName: "customEvent",
        player: 0,
        sourceUid: ogre.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    expectRestoredLegalActions(restoredOpen, 0);
    const trigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === ogre.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, trigger!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    if (restoredOpen.session.state.pendingTriggers.length > 0) {
      const statTrigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === ogre.uid);
      expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
      applyRestoredAction(restoredOpen, statTrigger!);
    }

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    const summonedOgre = restoredChain.session.state.cards.find((card) => card.uid === ogre.uid);
    expect(summonedOgre).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ogre.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(summonedOgre, restoredChain.session.state)).toBe(1900);
    expect(currentDefense(summonedOgre, restoredChain.session.state)).toBe(1200);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === ogre.uid && [102, 106, 332].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", range: ["monsterZone"], reset: { flags: 33492992 }, targetRange: undefined, value: 1900 },
      { code: 106, event: "continuous", range: ["monsterZone"], reset: { flags: 33492992 }, targetRange: undefined, value: 1200 },
      { code: 332, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, targetRange: [0, 4], value: undefined },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ogre.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: ogre.uid,
        eventReasonEffectId: 1,
        eventUids: [ogre.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function declareDirectAttack(restored: ReturnType<typeof restoreDuelWithLuaScripts>, attackerUid: string): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const attack = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack);
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredAction(restored, attack!);
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  passRestoredBattleUntil(restored, () => restored.session.state.pendingBattle === undefined && restored.session.state.chain.length === 0);
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(40);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

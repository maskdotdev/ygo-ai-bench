import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, linkSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const thrasherCode = "91557476";
const dryasCode = "93896655";
const battleTargetCode = "915574760";
const responderCode = "915574761";
const linkMaterialCode = "915574762";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasThrasherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thrasherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const racePlant = 0x400;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasThrasherScript)("Lua real script Sunvine Thrasher link stat battle revive", () => {
  it("restores delayed Special Summon target selection into Sunavalon Link-scaled ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${thrasherCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const thrasher = requireCard(session, thrasherCode);
    const dryas = requireCard(session, dryasCode);
    const material = requireCard(session, linkMaterialCode);
    moveFaceUpAttack(session, dryas, 0, 1);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thrasherCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    moveFaceUpAttack(session, material, 0, 2);
    linkSummonDuelCard(session.state, 0, thrasher.uid, [material.uid]);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === thrasher.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ type: "activateTrigger", uid: thrasher.uid, windowKind: "triggerBucket", triggerBucket: "turnOptional" });
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === thrasher.uid), restoredTrigger.session.state)).toBe(1600);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === thrasher.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x20000, range: ["monsterZone"], reset: { flags: 33492992 }, value: 800 },
    ]);
  });

  it("restores battle-destroying target card into pointed-zone revive and disable effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${thrasherCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const thrasher = requireCard(session, thrasherCode);
    const dryas = requireCard(session, dryasCode);
    const target = requireCard(session, battleTargetCode);
    moveFaceUpAttack(session, dryas, 0, 1);
    moveFaceUpAttack(session, thrasher, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thrasherCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === thrasher.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passBattleResponses(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      previousLocation: "monsterZone",
      previousPosition: "faceUpAttack",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: thrasher.uid,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: target.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: thrasher.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === thrasher.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: thrasher.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 8].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { flags: 33427456 }, sourceUid: target.uid },
      { code: 8, event: "continuous", reset: { flags: 33427456 }, sourceUid: target.uid },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,s.matfilter,1,1)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("e1:SetValue(tc:GetLink()*800)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e3:SetCondition(aux.bdogcon)");
  expect(script).toContain("Duel.SetTargetCard(bc)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,bc,1,0,0)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP,zone)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => [thrasherCode, dryasCode].includes(card.code)),
    { code: battleTargetCode, name: "Sunvine Thrasher Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 400, defense: 400 },
    { code: responderCode, name: "Sunvine Thrasher Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: linkMaterialCode, name: "Sunvine Thrasher Normal Plant Material", kind: "monster", typeFlags: typeMonster | typeNormal, race: racePlant, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
  ];
  const dryas = cards.find((card) => card.code === dryasCode);
  if (dryas) dryas.linkMarkers = 0x20;
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 91557476, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [linkMaterialCode], extra: [thrasherCode, dryasCode] }, 1: { main: [battleTargetCode, responderCode] } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      const loaded = workspace.readScript(name);
      if (loaded === undefined) throw new Error(`Missing script ${name}`);
      return loaded;
    },
  };
  return { session, reader, source };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("sunvine thrasher responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence?: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (sequence !== undefined) moved.sequence = sequence;
  return moved;
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

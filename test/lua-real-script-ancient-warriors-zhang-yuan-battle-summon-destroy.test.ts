import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const zhangYuanCode = "60033398";
const ancientWarriorCode = "600333980";
const opponentBattlerCode = "600333981";
const opponentDestroyedCode = "600333982";
const opponentTargetCode = "600333983";
const responderCode = "600333984";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasZhangYuanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zhangYuanCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceBeastWarrior = 0x8000;
const attributeFire = 0x4;
const setAncientWarriors = 0x137;

describe.skipIf(!hasUpstreamScripts || !hasZhangYuanScript)("Lua real script Ancient Warriors Zhang Yuan battle summon destroy", () => {
  it("restores Battle Start hand trigger into self Special Summon and opponent battler ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zhangYuanCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const zhangYuan = requireCard(session, zhangYuanCode);
    const ancientWarrior = requireCard(session, ancientWarriorCode);
    const opponentBattler = requireCard(session, opponentBattlerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, zhangYuan.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveFaceUpAttack(session, ancientWarrior, 0);
    moveFaceUpAttack(session, opponentBattler, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zhangYuanCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ancientWarrior.uid && action.targetUid === opponentBattler.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passUntilBattleStarted(restoredOpen);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1132",
        effectLabelObjectUid: opponentBattler.uid,
        eventCardUid: ancientWarrior.uid,
        eventCode: 1132,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleStarted",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [ancientWarrior.uid, opponentBattler.uid],
        player: 0,
        sourceUid: zhangYuan.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === zhangYuan.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    expect(restoredTrigger.host.messages).not.toContain("zhang yuan responder resolved");
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === zhangYuan.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: zhangYuan.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentBattler.uid), restoredTrigger.session.state)).toBe(800);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleStarted", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: ancientWarrior.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [ancientWarrior.uid, opponentBattler.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: zhangYuan.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: zhangYuan.uid,
        eventReasonEffectId: 1,
        eventUids: [zhangYuan.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });

  it("restores delayed destroyed trigger into opponent on-field target destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zhangYuanCode}.lua`);
    expectScriptShape(script);

    const { session, reader, source } = createSession(workspace);
    const zhangYuan = requireCard(session, zhangYuanCode);
    const opponentDestroyed = requireCard(session, opponentDestroyedCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, zhangYuan, 0);
    moveFaceUpAttack(session, opponentDestroyed, 1);
    const targetSpell = moveDuelCard(session.state, opponentTarget.uid, "spellTrapZone", 1);
    targetSpell.faceUp = true;
    targetSpell.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zhangYuanCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, opponentDestroyed.uid, 1, duelReason.effect | duelReason.destroy, 0, "graveyard", { eventReasonCardUid: zhangYuan.uid, eventReasonEffectId: 99 });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === zhangYuan.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: zhangYuan.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentDestroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: zhangYuan.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponentDestroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: zhangYuan.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: opponentTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: zhangYuan.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponentTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: zhangYuan.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("local tc=Duel.GetAttacker()");
  expect(script).toContain("local bc=Duel.GetAttackTarget()");
  expect(script).toContain("e:SetLabelObject(bc)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("bc:IsRelateToBattle() and bc:IsFaceup() and bc:IsControler(1-tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_ONFIELD) and c:GetPreviousControler()==1-tp and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function createSession(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zhangYuanCode),
    { code: ancientWarriorCode, name: "Zhang Yuan Ancient Warrior Battler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000, setcodes: [setAncientWarriors] },
    { code: opponentBattlerCode, name: "Zhang Yuan Opponent Battler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: opponentDestroyedCode, name: "Zhang Yuan Opponent Destroyed Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Zhang Yuan Opponent Target Spell", kind: "spell", typeFlags: typeSpell },
    { code: responderCode, name: "Zhang Yuan Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 60033398, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [zhangYuanCode, ancientWarriorCode] }, 1: { main: [opponentBattlerCode, opponentDestroyedCode, opponentTargetCode, responderCode] } });
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
      e:SetOperation(function(e,tp) Debug.Message("zhang yuan responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "startDamageStep") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

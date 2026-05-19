import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const damageMageCode = "50613779";
const hasDamageMageScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${damageMageCode}.lua`));
const burnSourceCode = "506137790";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDamageMageScript)("Lua real script Damage Mage event damage summon recover", () => {
  it("restores effect-damage hand trigger into self Special Summon and event-value recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${damageMageCode}.lua`);
    expect(script).toBeDefined();
    const scriptText = script!;
    expect(scriptText).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_RECOVER)");
    expect(scriptText).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(scriptText).toContain("e1:SetRange(LOCATION_HAND)");
    expect(scriptText).toContain("e1:SetCode(EVENT_DAMAGE)");
    expect(scriptText).toContain("return ep==tp and (r&REASON_EFFECT)~=0");
    expect(scriptText).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
    expect(scriptText).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(scriptText).toContain("Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,ev)");
    expect(scriptText).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(scriptText).toContain("Duel.Recover(tp,ev,REASON_EFFECT)");
    const operationInfos = scriptText.match(/Duel.SetOperationInfo/g) ?? [];
    expect(operationInfos).toHaveLength(2);

    const cards: DuelCardData[] = [
      { code: damageMageCode, name: "Damage Mage", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 600, defense: 1200 },
      { code: burnSourceCode, name: "Damage Mage Burn Source", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 50613779, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [damageMageCode, burnSourceCode] }, 1: { main: [] } });
    startDuel(session);

    const damageMage = requireCard(session, damageMageCode);
    const burnSource = requireCard(session, burnSourceCode);
    moveDuelCard(session.state, damageMage.uid, "hand", 0);
    moveDuelCard(session.state, burnSource.uid, "monsterZone", 0);
    burnSource.position = "faceUpAttack";
    burnSource.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${burnSourceCode}.lua`) return burnSourceScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(damageMageCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(burnSourceCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const burn = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === burnSource.uid);
    expect(burn, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, burn!);
    resolveChain(session);
    expect(session.state.players[0].lifePoints).toBe(7100);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1111",
        sourceUid: damageMage.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnSource.uid,
        eventReasonEffectId: 2,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === damageMage.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === damageMage.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: damageMage.uid,
    });
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["damageDealt", "specialSummoned", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnSource.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: damageMage.uid,
        eventUids: [damageMage.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageMage.uid,
        eventReasonEffectId: 1,
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
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageMage.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function burnSourceScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Duel.Damage(tp,900,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(result.legalActions).toEqual(getLegalActions(session, player));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player!), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

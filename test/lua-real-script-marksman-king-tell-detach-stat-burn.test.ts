import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
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
const marksmanKingTellCode = "71612253";
const hasMarksmanKingTellScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${marksmanKingTellCode}.lua`));
const materialCode = "716122530";
const targetCode = "716122531";
const burnSourceCode = "716122532";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasMarksmanKingTellScript)("Lua real script D/D/D Marksman King Tell detach stat burn", () => {
  it("restores global damage flag into detached quick effect, target ATK/DEF loss, and effect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${marksmanKingTellCode}.lua`);
    expect(script).toBeDefined();
    const scriptText = script!;
    expect(scriptText).toContain("aux.GlobalCheck(s,function()");
    expect(scriptText).toContain("ge1:SetCode(EVENT_DAMAGE)");
    expect(scriptText).toContain("Duel.RegisterFlagEffect(ep,id,RESET_PHASE|PHASE_END,0,1)");
    expect(scriptText).toContain("return Duel.GetFlagEffect(tp,id)~=0");
    expect(scriptText).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(scriptText).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(scriptText).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,1000)");
    expect(scriptText).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(scriptText).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(scriptText).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: marksmanKingTellCode, name: "D/D/D Marksman King Tell", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 5, attack: 2300, defense: 2000 },
      { code: materialCode, name: "Marksman King Tell Overlay Material", kind: "monster", typeFlags: typeMonster, level: 5, attack: 900, defense: 900 },
      { code: targetCode, name: "Marksman King Tell Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1600 },
      { code: burnSourceCode, name: "Marksman King Tell Flag Source", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 71612253, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, targetCode, burnSourceCode], extra: [marksmanKingTellCode] }, 1: { main: [] } });
    startDuel(session);

    const tell = requireCard(session, marksmanKingTellCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    const burnSource = requireCard(session, burnSourceCode);
    moveDuelCard(session.state, tell.uid, "monsterZone", 0).position = "faceUpAttack";
    tell.faceUp = true;
    moveDuelCard(session.state, material.uid, "overlay", 0);
    tell.overlayUids.push(material.uid);
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, burnSource.uid, "monsterZone", 0).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(marksmanKingTellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(burnSourceCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const gatedActions = getLegalActions(session, 0).filter((action) => action.type === "activateEffect" && action.uid === tell.uid);
    expect(gatedActions).toEqual([]);

    const burn = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === burnSource.uid);
    expect(burn, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, burn!);
    resolveChain(session);
    expect(session.state.players[0].lifePoints).toBe(7500);
    expect(session.state.eventHistory.filter((event) => event.eventName === "damageDealt" && event.eventPlayer === 0)).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnSource.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activateTell = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tell.uid);
    expect(activateTell, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activateTell!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tell.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: tell.uid,
    });

    const restoredTell = restoredOpen.session.state.cards.find((card) => card.uid === tell.uid);
    expect(restoredTell).toBeDefined();
    expect(currentAttack(restoredTell, restoredOpen.session.state)).toBe(1300);
    expect(currentDefense(restoredTell, restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === tell.uid && [100, 104].includes(effect.code ?? -1))).toHaveLength(2);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: burnSource.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: tell.uid,
        eventReasonEffectId: 3,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tell.uid,
        eventReasonEffectId: 3,
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
        Duel.Damage(tp,500,REASON_EFFECT)
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelPhase, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const setMorphtronic = 0x26;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Junk Box revive and End Phase destroy", () => {
  it("restores its Morphtronic Graveyard revive and target-owned End Phase destruction watcher", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const junkBoxCode = "37745919";
    const morphtronicTargetCode = "37745920";
    const highLevelDecoyCode = "37745921";
    const offSetDecoyCode = "37745922";
    const responderCode = "37745923";
    const script = workspace.readScript(`c${junkBoxCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsSetCard(SET_MORPHTRONIC) and c:IsLevelBelow(4) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === junkBoxCode),
      { code: morphtronicTargetCode, name: "Junk Box Morphtronic Target", kind: "monster", typeFlags: typeMonster, setcodes: [setMorphtronic], level: 4, attack: 1500, defense: 1000 },
      { code: highLevelDecoyCode, name: "Junk Box Level 5 Morphtronic Decoy", kind: "monster", typeFlags: typeMonster, setcodes: [setMorphtronic], level: 5, attack: 1800, defense: 1200 },
      { code: offSetDecoyCode, name: "Junk Box Level 4 Off-Set Decoy", kind: "monster", typeFlags: typeMonster, setcodes: [0x123], level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Junk Box Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 37745919, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [junkBoxCode, morphtronicTargetCode, highLevelDecoyCode, offSetDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const junkBox = requireCard(session, junkBoxCode);
    const morphtronicTarget = requireCard(session, morphtronicTargetCode);
    const highLevelDecoy = requireCard(session, highLevelDecoyCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, junkBox.uid, "hand", 0);
    moveDuelCard(session.state, morphtronicTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, highLevelDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, offSetDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(junkBoxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === junkBox.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: junkBox.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [morphtronicTarget.uid],
        operationInfos: [{ category: 0x200, targetUids: [morphtronicTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === junkBox.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === morphtronicTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highLevelDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("junk box responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === morphtronicTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: morphtronicTarget.uid,
        eventUids: [morphtronicTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: junkBox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(
      restoredChain.session.state.effects.filter(
        (effect) => effect.event === "continuous" && effect.triggerEvent === "phaseEnd" && effect.sourceUid === morphtronicTarget.uid,
      ),
    ).toEqual([
      expect.objectContaining({
        code: 0x1200,
        controller: 0,
        countLimit: 1,
        registryKey: `lua:${junkBoxCode}:lua-3-4608`,
        reset: { flags: 0x41fe1200 },
        sourceUid: morphtronicTarget.uid,
        triggerCode: 0x1200,
        triggerEvent: "phaseEnd",
      }),
    ]);

    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEndPhase);
    expectRestoredLegalActions(restoredEndPhase, 0);
    advanceRestoredToPhase(restoredEndPhase, 0, ["battle", "main2", "end"]);
    expect(restoredEndPhase.session.state.pendingTriggers).toEqual([]);
    expect(restoredEndPhase.session.state.cards.find((card) => card.uid === morphtronicTarget.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredEndPhase.session.state.effects.find((effect) => effect.id === "lua-3-4608")).toBeUndefined();
    expect(restoredEndPhase.session.state.log).toContainEqual(expect.objectContaining({ action: "destroy", card: morphtronicTarget.name }));
    expectRestoredLegalActions(restoredEndPhase, 0);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("junk box responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function advanceRestoredToPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phases: DuelPhase[]): void {
  for (const phase of phases) {
    expectRestoredLegalActions(restored, player);
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, action!);
  }
}

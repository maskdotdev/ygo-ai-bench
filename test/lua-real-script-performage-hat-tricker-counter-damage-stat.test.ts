import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hatCode = "31292357";
const burnSpellCode = "312923570";
const monsterACode = "312923571";
const monsterBCode = "312923572";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hatCode}.lua`));
const counterSpell = 0x36;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const categoryCounter = 0x800000;
const effectChangeDamage = 82;
const effectSpecialSummonProcedure = 34;
const effectSetAttackFinal = 30;
const effectSetDefenseFinal = 32;
const effectCounterPermit = 0x10000 + counterSpell;
const effectCounterLimit = 0x20000 + counterSpell;
const eventAddSpellCounter = 0x10000 + counterSpell;
const eventChaining = 1027;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasHatScript)("Lua real script Performage Hat Tricker counter damage stat", () => {
  it("restores its two-monster hand Special Summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${hatCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 31292357, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hatCode, monsterACode, monsterBCode] }, 1: { main: [] } });
    startDuel(session);

    const hat = requireCard(session, hatCode);
    const monsterA = requireCard(session, monsterACode);
    const monsterB = requireCard(session, monsterBCode);
    moveDuelCard(session.state, hat.uid, "hand", 0);
    moveFaceUpAttack(session, monsterA, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hatCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    let restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(specialProcedure(restored, hat.uid)).toBeUndefined();

    moveFaceUpAttack(session, monsterB, 1);
    restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const procedure = specialProcedure(restored, hat.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredAction(restored, procedure!);
    expect(restored.session.state.cards.find((card) => card.uid === hat.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
  });

  it("restores damage-chain counter placement into final ATK and DEF at three counters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${hatCode}.lua`));
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${burnSpellCode}.lua`) return burnProbeScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 31292358, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hatCode, burnSpellCode] }, 1: { main: [] } });
    startDuel(session);

    const hat = requireCard(session, hatCode);
    const burnSpell = requireCard(session, burnSpellCode);
    moveFaceUpAttack(session, hat, 0);
    expect(addDuelCardCounter(hat, counterSpell, 2)).toBe(true);
    moveDuelCard(session.state, burnSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(burnSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === hat.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: effectCounterPermit, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: hat.uid },
      { category: undefined, code: effectCounterLimit, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: hat.uid },
      { category: undefined, code: effectSpecialSummonProcedure, event: "summonProcedure", property: 0x40000, range: ["hand"], sourceUid: hat.uid },
      { category: categoryCounter, code: eventChaining, event: "quick", property: undefined, range: ["monsterZone"], sourceUid: hat.uid },
      { category: undefined, code: eventAddSpellCounter, event: "continuous", property: undefined, range: allLocations, sourceUid: hat.uid },
    ]);

    const burn = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === burnSpell.uid);
    expect(burn, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, burn!);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    const responsePlayer = restoredChain.session.state.waitingFor ?? 0;
    expectRestoredLegalActions(restoredChain, responsePlayer);

    const hatCounter = getLuaRestoreLegalActions(restoredChain, 0).find((action) => action.type === "activateEffect" && action.uid === hat.uid);
    expect(hatCounter, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredChain, hatCounter!);
    passRestoredChain(restoredChain);

    const restoredHat = restoredChain.session.state.cards.find((card) => card.uid === hat.uid);
    expect(getDuelCardCounter(restoredHat, counterSpell)).toBe(3);
    expect(currentAttack(restoredHat, restoredChain.session.state)).toBe(3300);
    expect(currentDefense(restoredHat, restoredChain.session.state)).toBe(3300);
    expect(restoredChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "counterAdded")).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: hat.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hat.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: hatCode, name: "Performage Hat Tricker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1100, defense: 1100 },
    { code: burnSpellCode, name: "Hat Tricker Damage Probe", kind: "spell", typeFlags: typeSpell },
    { code: monsterACode, name: "Hat Tricker Field Monster A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: monsterBCode, name: "Hat Tricker Field Monster B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Performage Hat Tricker");
  expect(script).toContain("c:EnableCounterPermit(0x36)");
  expect(script).toContain("c:SetCounterLimit(0x36,3)");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,LOCATION_MZONE)>=2");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e2:SetCondition(aux.damcon1)");
  expect(script).toContain("c:AddCounter(0x36,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_DAMAGE)");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_CHAIN_ID)");
  expect(script).toContain("e3:SetCode(EVENT_ADD_COUNTER+0x36)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x36)==3");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
}

function burnProbeScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,1000)
      end)
      e:SetOperation(function(e,tp) Duel.Damage(tp,1000,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function specialProcedure(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): Extract<DuelAction, { type: "specialSummonProcedure" }> | undefined {
  return getLuaRestoreLegalActions(restored, 0).find(
    (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === uid,
  );
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

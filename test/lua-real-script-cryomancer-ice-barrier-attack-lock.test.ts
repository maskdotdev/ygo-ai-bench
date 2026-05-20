import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const cryomancerCode = "23950192";
const allyCode = "239501920";
const highAttackerCode = "239501921";
const lowAttackerCode = "239501922";
const setIceBarrier = 0x2f;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cryomancer Ice Barrier attack lock", () => {
  it("restores aux.FaceupFilter setcode condition for its Level attack-announcement lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${cryomancerCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_ICE_BARRIER),e:GetHandler():GetControler(),LOCATION_MZONE,0,1,e:GetHandler())");
    expect(script).toContain("return c:GetLevel()>=4");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cryomancerCode),
      { code: allyCode, name: "Cryomancer Fixture Ice Barrier Ally", kind: "monster", typeFlags: 0x1, setcodes: [setIceBarrier], level: 4, attack: 1000, defense: 1000 },
      { code: highAttackerCode, name: "Cryomancer Fixture Level Four Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: lowAttackerCode, name: "Cryomancer Fixture Level Three Attacker", kind: "monster", typeFlags: 0x1, level: 3, attack: 1400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 23950192, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cryomancerCode, allyCode] }, 1: { main: [highAttackerCode, lowAttackerCode] } });
    startDuel(session);

    const cryomancer = requireCard(session, cryomancerCode);
    const ally = requireCard(session, allyCode);
    const highAttacker = requireCard(session, highAttackerCode);
    const lowAttacker = requireCard(session, lowAttackerCode);
    moveFaceUpAttack(session, cryomancer, 0);
    const setAlly = moveDuelCard(session.state, ally.uid, "monsterZone", 0);
    setAlly.faceUp = false;
    setAlly.position = "faceDownDefense";
    moveFaceUpAttack(session, highAttacker, 1);
    moveFaceUpAttack(session, lowAttacker, 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cryomancerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === cryomancer.uid && effect.code === 86)).toMatchObject({
      event: "continuous",
      range: ["monsterZone"],
      targetRange: [4, 4],
    });

    const faceDownAlly = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(faceDownAlly);
    expectRestoredLegalActions(faceDownAlly, 1);
    expect(faceDownAlly.host.loadScript(canAttackProbe(highAttackerCode, lowAttackerCode, "face-down ally"), "cryomancer-face-down-ally-probe.lua").ok).toBe(true);
    expect(faceDownAlly.host.messages).toContain("cryomancer face-down ally CanAttack true/true");
    expect(hasAttack(getLuaRestoreLegalActions(faceDownAlly, 1), highAttacker.uid, cryomancer.uid)).toBe(true);

    ally.faceUp = true;
    ally.position = "faceUpDefense";
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.host.loadScript(canAttackProbe(highAttackerCode, lowAttackerCode, "face-up ally"), "cryomancer-face-up-ally-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("cryomancer face-up ally CanAttack false/true");
    const actions = getLuaRestoreLegalActions(restored, 1);
    expect(hasAttack(actions, highAttacker.uid, cryomancer.uid)).toBe(false);
    expect(hasAttack(actions, lowAttacker.uid, cryomancer.uid)).toBe(true);

    const attack = actions.find((action) => action.type === "declareAttack" && action.attackerUid === lowAttacker.uid && action.targetUid === cryomancer.uid);
    expect(attack, JSON.stringify(actions, null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, attack!);
    expect(result.ok, result.error).toBe(true);
    const waitingFor = restored.session.state.waitingFor ?? 1;
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });
});

function canAttackProbe(highCode: string, lowCode: string, label: string): string {
  return `
    local high=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highCode}),0,0,LOCATION_MZONE,nil)
    local low=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message("cryomancer ${label} CanAttack " .. tostring(high and high:CanAttack()) .. "/" .. tostring(low and low:CanAttack()))
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

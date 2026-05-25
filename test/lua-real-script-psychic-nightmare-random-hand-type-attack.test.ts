import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const nightmareCode = "7582066";
const opponentMonsterCode = "75820660";
const psychicMaterialCode = "75820661";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNightmareScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nightmareCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const racePsychic = 0x100000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardDisablePhaseEnd = 0x41ff1200;

describe.skipIf(!hasUpstreamScripts || !hasNightmareScript)("Lua real script Psychic Nightmare random hand type attack", () => {
  it("restores random opponent hand confirmation and correct monster type guess into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${nightmareCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 7582066, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [psychicMaterialCode], extra: [nightmareCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const nightmare = requireCard(session, nightmareCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveFaceUpAttack(session, nightmare, 0, 0);
    moveDuelCard(session.state, opponentMonster.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nightmareCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(nightmare.data).toMatchObject({ synchroTunerMin: 1, synchroTunerMax: 1, synchroNonTunerMin: 1, synchroNonTunerMax: 99, synchroNonTunerRace: racePsychic });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.cards.find((card) => card.uid === nightmare.uid)?.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
      synchroNonTunerRace: racePsychic,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === nightmare.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", range: ["monsterZone"], sourceUid: nightmare.uid },
      { category: 2097152, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"], sourceUid: nightmare.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === nightmare.uid,
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption")).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1, 2], descriptions: [70, 71, 72], returned: 0 },
    ]);
    expect(restored.host.messages).toContain(`confirmed 0: ${opponentMonsterCode}`);
    expect(restored.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nightmare.uid), restored.session.state)).toBe(3400);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === nightmare.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { count: 2, flags: resetStandardDisablePhaseEnd }, sourceUid: nightmare.uid, value: 1000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "confirmed").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventName: "confirmed", eventCode: 1211, eventCardUid: opponentMonster.uid, eventPlayer: 0, eventReason: 0, eventReasonPlayer: 1, eventValue: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === nightmare.uid), restoredAfter.session.state)).toBe(3400);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Psychic Nightmare");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsRace,RACE_PSYCHIC),1,99)");
  expect(script).toContain("return Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)~=0");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_HAND):RandomSelect(tp,1,nil)");
  expect(script).toContain("Duel.SelectOption(tp,70,71,72)");
  expect(script).toContain("Duel.ConfirmCards(tp,tc)");
  expect(script).toContain("Duel.ShuffleHand(1-tp)");
  expect(script).toContain("if (op==0 and tc:IsMonster()) or (op==1 and tc:IsSpell()) or (op==2 and tc:IsTrap()) then");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
}

function cards(): DuelCardData[] {
  return [
    { code: nightmareCode, name: "Psychic Nightmare", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: racePsychic, attribute: attributeDark, level: 6, attack: 2400, defense: 1800 },
    { code: opponentMonsterCode, name: "Psychic Nightmare Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: psychicMaterialCode, name: "Psychic Nightmare Psychic Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 3, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

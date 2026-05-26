import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const slashCode = "94807487";
const utopiaCode = "948074870";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSlashScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slashCode}.lua`));
const counterRisingSun = 0x31;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const typeXyz = 0x800000;
const setUtopia = 0x107f;
const effectIndestructableEffect = 76;
const effectUpdateAttack = 100;
const effectOverlayRemoveReplace = 245;
const eventAttackDisabled = 1142;

describe.skipIf(!hasUpstreamScripts || !hasSlashScript)("Lua real script Rising Sun Slash counter stat", () => {
  it("restores equipped counter-scaling ATK and overlay-remove replacement metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${slashCode}.lua`));
    const reader = createCardReader(cards());
    const restored = createRestoredEquipped({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const slash = requireCard(restored.session, slashCode);
    const utopia = requireCard(restored.session, utopiaCode);
    expect(findCard(restored.session, slash.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: utopia.uid,
      cardTargetUids: [utopia.uid],
      faceUp: true,
    });
    expect(getDuelCardCounter(findCard(restored.session, slash.uid), counterRisingSun)).toBe(2);
    expect(currentAttack(findCard(restored.session, utopia.uid), restored.session.state)).toBe(3500);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === slash.uid && [effectIndestructableEffect, effectUpdateAttack, effectOverlayRemoveReplace, eventAttackDisabled].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableEffect, event: "continuous", property: 0x400, range: ["spellTrapZone"], sourceUid: slash.uid, value: undefined },
      { code: eventAttackDisabled, event: "continuous", property: 0x10000, range: ["spellTrapZone"], sourceUid: slash.uid, value: undefined },
      { code: effectUpdateAttack, event: "continuous", property: undefined, range: ["spellTrapZone"], sourceUid: slash.uid, value: undefined },
      { code: effectOverlayRemoveReplace, event: "continuous", property: undefined, range: ["spellTrapZone"], sourceUid: slash.uid, value: undefined },
    ]);

    const restoredAgain = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAgain);
    expectRestoredLegalActions(restoredAgain, 0);
    expect(currentAttack(findCard(restoredAgain.session, utopia.uid), restoredAgain.session.state)).toBe(3500);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: slashCode, name: "Rising Sun Slash", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: utopiaCode, name: "Rising Sun Slash Utopia", kind: "extra", typeFlags: typeMonster | typeXyz, setcodes: [setUtopia], level: 4, attack: 2500, defense: 2000 },
  ];
}

function createRestoredEquipped({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 94807487, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [slashCode], extra: [utopiaCode] }, 1: { main: [] } });
  startDuel(session);
  const slash = requireCard(session, slashCode);
  const utopia = requireCard(session, utopiaCode);
  moveFaceUpAttack(session, utopia, 0, 0);
  const equipped = moveFaceUpEquip(session, slash, 0, 0, utopia.uid);
  expect(addDuelCardCounter(equipped, counterRisingSun, 2)).toBe(true);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(slashCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Rising Sun Slash");
  expect(script).toContain("c:EnableCounterPermit(0x31)");
  expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsSetCard,SET_UTOPIA))");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e4:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e4:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e4:SetCode(EVENT_ATTACK_DISABLED)");
  expect(script).toContain("e:GetHandler():AddCounter(0x31,1)");
  expect(script).toContain("e5:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x31)*500");
  expect(script).toContain("e6:SetCode(EFFECT_OVERLAY_REMOVE_REPLACE)");
  expect(script).toContain("re:GetHandler():IsType(TYPE_XYZ)");
  expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, equippedToUid: string): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
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

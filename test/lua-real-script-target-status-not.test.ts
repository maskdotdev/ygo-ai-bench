import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const invitationCode = "86527709";
const hasInvitationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${invitationCode}.lua`));
const statusSummonedThisTurn = 0x800 | 0x20000000 | 0x40000000;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeLink = 0x4000000;

describe.skipIf(!hasUpstreamScripts || !hasInvitationScript)("Lua real script target negated status", () => {
  it("restores target predicates using not IsStatus masks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "72329844";
    const script = workspace.readScript(`c${invitationCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_RACE)");
    expect(script).toContain("not c:IsStatus(STATUS_SUMMON_TURN|STATUS_FLIP_SUMMON_TURN|STATUS_SPSUMMON_TURN)");
    expect(script).toContain("e1:SetValue(RACE_INSECT)");
    const cards: DuelCardData[] = [
      { code: invitationCode, name: "Insect Invitation", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: targetCode, name: "Target Status Link Probe", kind: "extra", typeFlags: typeMonster | typeLink, level: 2, attack: 1400, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7901, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [invitationCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const invitation = session.state.cards.find((card) => card.code === invitationCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(invitation).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, invitation!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(invitationCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.code === 122 &&
          effect.luaTargetDescriptor === `target:not-status:${statusSummonedThisTurn}` &&
          effect.sourceUid === invitation!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 122,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-122",
          "luaTargetDescriptor": "target:not-status:1610614784",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:86527709:lua-2-122",
          "sourceUid": "p0-deck-86527709-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            0,
            4,
          ],
          "value": 2048,
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === invitation!.uid && candidate.luaTargetDescriptor === `target:not-status:${statusSummonedThisTurn}`);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
    restoredTarget!.summonType = "link";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(false);
    restoredTarget!.summonType = "normal";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(false);
    delete restoredTarget!.summonType;
    restoredTarget!.customStatusMask = 0x20;
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
  });
});
